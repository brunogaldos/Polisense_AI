"""Firestore-backed conversation memory — Python port of
backend/src/services/firestoreMemoryService.ts (read side).

Same collection (`chatbot_memories`) and document shape as the Node backend.
This phase ports only the read paths needed by the non-chat HTTP routes:
load_memory (chat log recovery), user conversation list, conversation documents,
vector-store id, geojson summaries, and metadata update. The write paths
(save_memory, add/update/remove document) come with the ingestion + chat phases.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.config.firebase import db

logger = logging.getLogger(__name__)

COLLECTION_NAME = "chatbot_memories"

_VALID_SENDERS = {"user", "assistant", "system"}


def _to_iso(value: Any) -> Optional[str]:
    """Firestore returns timestamps as datetime; serialize to ISO-8601 string."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _normalize_sender(msg: dict[str, Any]) -> str:
    # PolicySynth stores assistant turns as sender='bot'; normalize to 'assistant'
    # so the frontend styles them correctly (mirrors fromFirestoreFormat in TS).
    sender = "assistant" if msg.get("sender") == "bot" else msg.get("sender")
    if sender in _VALID_SENDERS:
        return sender
    message_type = msg.get("messageType")
    if message_type in ("research_result", "intermediate", "completed"):
        return "assistant"
    if message_type == "user_query":
        return "user"
    return "user"


def _normalize_chat_log(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for msg in raw:
        if not isinstance(msg, dict):
            continue
        out.append(
            {
                "sender": _normalize_sender(msg),
                "message": msg.get("message") or "",
                "messageType": msg.get("messageType"),
                "timestamp": _to_iso(msg.get("timestamp")) or datetime.now(timezone.utc).isoformat(),
                "id": msg.get("id"),
            }
        )
    return out


def _remove_none(obj: Any) -> Any:
    """Recursively drop None values — Firestore mirrors the Node removeUndefinedValues
    so a partial update never overwrites a stored field with null."""
    if isinstance(obj, list):
        return [_remove_none(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _remove_none(v) for k, v in obj.items() if v is not None}
    return obj


def _normalize_documents(raw: Any) -> Optional[list[dict[str, Any]]]:
    if not isinstance(raw, list) or not raw:
        return None
    docs: list[dict[str, Any]] = []
    for d in raw:
        if not isinstance(d, dict):
            continue
        doc = dict(d)
        if "uploadTime" in doc:
            doc["uploadTime"] = _to_iso(doc["uploadTime"])
        docs.append(doc)
    return docs


class FirestoreMemoryService:
    @staticmethod
    def _from_firestore(data: dict[str, Any]) -> dict[str, Any]:
        memory: dict[str, Any] = {
            "memoryId": data.get("memoryId"),
            "chatLog": _normalize_chat_log(data.get("chatLog")),
            "stages": data.get("stages") or {},
            "totalCost": data.get("totalCost") or 0,
            "currentStage": data.get("currentStage"),
            "ragCorpusName": data.get("ragCorpusName"),
        }
        if data.get("userId") is not None:
            memory["userId"] = data["userId"]
        docs = _normalize_documents(data.get("uploadedDocuments"))
        if docs:
            memory["uploadedDocuments"] = docs
        return memory

    @staticmethod
    def load_memory(memory_id: str) -> Optional[dict[str, Any]]:
        try:
            snap = db.collection(COLLECTION_NAME).document(memory_id).get()
            if not snap.exists:
                logger.info("Memory not found in Firestore: %s", memory_id)
                return None
            return FirestoreMemoryService._from_firestore(snap.to_dict() or {})
        except Exception:  # noqa: BLE001 - log and degrade like the Node service
            logger.exception("Error loading memory from Firestore: %s", memory_id)
            return None

    @staticmethod
    def save_memory(
        memory_id: str, memory: dict[str, Any], user_id: Optional[str] = None
    ) -> None:
        """Persist a chat-turn memory — Python port of the write side of
        firestoreMemoryService.ts saveMemory + toFirestoreFormat.

        The chat turn only mutates `chatLog` (and cost stages); uploadedDocuments,
        when present, come straight from a prior load() so their storage refs
        (s3Key/ragFileId/ragCorpusName/...) are already intact — we write them
        back as-is under a merge so a concurrent ingest isn't clobbered. Uses
        set(merge=True); None fields are dropped so they never null out a stored
        value (mirrors removeUndefinedValues)."""
        try:
            ref = db.collection(COLLECTION_NAME).document(memory_id)

            stored_log: list[dict[str, Any]] = []
            for m in memory.get("chatLog") or []:
                if not isinstance(m, dict):
                    continue
                entry: dict[str, Any] = {
                    "sender": m.get("sender"),
                    "message": m.get("message") or "",
                }
                if m.get("messageType") is not None:
                    entry["messageType"] = m.get("messageType")
                if m.get("id") is not None:
                    entry["id"] = m.get("id")
                stored_log.append(entry)

            user_messages = [m for m in stored_log if m.get("sender") == "user"]
            last_user_message = user_messages[-1]["message"][:200] if user_messages else None

            # Title: first word of the first user message + first document name
            # (extension stripped) — matches the Node primary title path.
            conversation_title: Optional[str] = None
            first_user = next((m for m in stored_log if m.get("sender") == "user"), None)
            if first_user:
                first_word = (first_user["message"].strip().split() or [""])[0]
                docs = memory.get("uploadedDocuments")
                doc_name = ""
                if isinstance(docs, list) and docs:
                    raw_name = (docs[0] or {}).get("name") or ""
                    doc_name = re.sub(r"\.[^/.]+$", "", raw_name).strip()
                conversation_title = (f"{first_word} - {doc_name}" if doc_name else first_word)[:100]

            data: dict[str, Any] = {
                "memoryId": memory_id,
                "chatLog": stored_log,
                "stages": memory.get("stages") or {},
                "currentStage": memory.get("currentStage") or "chatbot-conversation",
                "totalCost": memory.get("totalCost") or 0,
                "messageCount": len(stored_log),
                "lastUserMessage": last_user_message,
                "conversationTitle": conversation_title,
                "userId": user_id if user_id is not None else memory.get("userId"),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
            if isinstance(memory.get("uploadedDocuments"), list):
                data["uploadedDocuments"] = memory["uploadedDocuments"]

            if not ref.get().exists:
                data["createdAt"] = firestore.SERVER_TIMESTAMP

            ref.set(_remove_none(data), merge=True)
            logger.info("Saved memory to Firestore: %s", memory_id)
        except Exception:  # noqa: BLE001 - never let a save failure break the turn
            logger.exception("Can't save memory to Firestore: %s", memory_id)

    @staticmethod
    def full_cost_of_memory(memory: dict[str, Any]) -> float:
        """Replicates PsBaseChatBot.getFullCostOfMemory: sum per-stage token costs.

        TODO(verify): confirm against a golden fixture from the Node backend that
        summing stage tokensInCost+tokensOutCost matches getFullCostOfMemory exactly.
        Falls back to the stored totalCost when no per-stage costs are present.
        """
        stages = memory.get("stages") or {}
        total = 0.0
        for stage in stages.values():
            if isinstance(stage, dict):
                total += float(stage.get("tokensInCost") or 0)
                total += float(stage.get("tokensOutCost") or 0)
        if total == 0.0:
            return float(memory.get("totalCost") or 0)
        return total

    @staticmethod
    def get_user_conversations(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        try:
            snapshot = (
                db.collection(COLLECTION_NAME)
                .where(filter=FieldFilter("userId", "==", user_id))
                .order_by("updatedAt", direction=firestore.Query.DESCENDING)
                .limit(limit)
                .get()
            )
            results: list[dict[str, Any]] = []
            for doc in snapshot:
                data = doc.to_dict() or {}
                conv = {
                    "memoryId": data.get("memoryId"),
                    "conversationTitle": data.get("conversationTitle"),
                    "lastUserMessage": data.get("lastUserMessage"),
                    "messageCount": data.get("messageCount")
                    or len(data.get("chatLog") or []),
                    "updatedAt": _to_iso(data.get("updatedAt")),
                    "createdAt": _to_iso(data.get("createdAt")),
                    "totalCost": data.get("totalCost") or 0,
                }
                docs = _normalize_documents(data.get("uploadedDocuments"))
                if docs:
                    conv["uploadedDocuments"] = [
                        {
                            "name": d.get("name") or "",
                            "size": d.get("size"),
                            "type": d.get("type"),
                            "uploadTime": d.get("uploadTime"),
                        }
                        for d in docs
                    ]
                results.append(conv)
            return results
        except Exception:  # noqa: BLE001
            logger.exception("Error loading user conversations for %s", user_id)
            return []

    @staticmethod
    def get_conversation_documents(memory_id: str) -> list[dict[str, Any]]:
        try:
            snap = db.collection(COLLECTION_NAME).document(memory_id).get()
            if not snap.exists:
                return []
            data = snap.to_dict() or {}
            return _normalize_documents(data.get("uploadedDocuments")) or []
        except Exception:  # noqa: BLE001
            logger.exception("Error getting conversation documents for %s", memory_id)
            return []

    @staticmethod
    def get_rag_corpus_name(memory_id: str) -> Optional[str]:
        try:
            snap = db.collection(COLLECTION_NAME).document(memory_id).get()
            if not snap.exists:
                return None
            return (snap.to_dict() or {}).get("ragCorpusName")
        except Exception:  # noqa: BLE001
            logger.exception("Error getting ragCorpusName for %s", memory_id)
            return None

    @staticmethod
    def get_geojson_summaries(memory_id: str) -> list[str]:
        try:
            snapshot = (
                db.collection(COLLECTION_NAME)
                .document(memory_id)
                .collection("geojson_summaries")
                .get()
            )
            all_summaries: list[str] = []
            for doc in snapshot:
                data = doc.to_dict() or {}
                summaries = data.get("summaries")
                if isinstance(summaries, list):
                    all_summaries.extend(summaries)
            return all_summaries
        except Exception:  # noqa: BLE001
            logger.exception("Error getting GeoJSON summaries for %s", memory_id)
            return []

    @staticmethod
    def update_conversation_metadata(memory_id: str, metadata: dict[str, Any]) -> None:
        # Drop None values — Firestore would otherwise overwrite fields with null.
        clean = {k: v for k, v in metadata.items() if v is not None}
        clean["updatedAt"] = firestore.SERVER_TIMESTAMP
        db.collection(COLLECTION_NAME).document(memory_id).update(clean)
        logger.info("Updated conversation metadata: %s", memory_id)

    @staticmethod
    def delete_memory(memory_id: str) -> None:
        db.collection(COLLECTION_NAME).document(memory_id).delete()
        logger.info("Deleted memory from Firestore: %s", memory_id)

    @staticmethod
    def add_or_update_document(
        memory_id: str, document: dict[str, Any], user_id: Optional[str] = None
    ) -> None:
        """Upsert one document into uploadedDocuments inside a transaction so
        concurrent uploads (multi-file drag-drop) don't clobber each other.
        Port of addOrUpdateDocument: match by id then name, preserve terminal
        extraction status and storage refs from the existing record."""
        ref = db.collection(COLLECTION_NAME).document(memory_id)
        doc = _remove_none(dict(document))

        @firestore.transactional
        def _txn(transaction) -> None:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                new_memory: dict[str, Any] = {
                    "memoryId": memory_id,
                    "chatLog": [],
                    "stages": {},
                    "totalCost": 0,
                    "currentStage": "chatbot-conversation",
                    "timeStart": firestore.SERVER_TIMESTAMP,
                    "createdAt": firestore.SERVER_TIMESTAMP,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                    "uploadedDocuments": [doc],
                }
                if user_id:
                    new_memory["userId"] = user_id
                transaction.set(ref, new_memory)
                return

            data = snap.to_dict() or {}
            existing_docs: list[dict[str, Any]] = list(data.get("uploadedDocuments") or [])

            idx = next((i for i, d in enumerate(existing_docs) if d.get("id") == document.get("id")), -1)
            if idx < 0 and document.get("name"):
                idx = next((i for i, d in enumerate(existing_docs) if d.get("name") == document.get("name")), -1)
                if idx >= 0:
                    doc["id"] = existing_docs[idx].get("id")  # keep the canonical id

            if idx >= 0:
                existing = existing_docs[idx]
                if existing.get("extractionStatus") in ("completed", "rag_ready") and doc.get("extractionStatus") == "pending":
                    doc["extractionStatus"] = existing.get("extractionStatus")
                    if existing.get("extractedMetadata") is not None:
                        doc["extractedMetadata"] = existing.get("extractedMetadata")
                    if existing.get("markdownFileName") is not None:
                        doc["markdownFileName"] = existing.get("markdownFileName")
                for field in ("s3Bucket", "s3Key", "ragFileId", "ragCorpusName"):
                    if not doc.get(field) and existing.get(field):
                        doc[field] = existing[field]
                existing_docs[idx] = doc
            else:
                existing_docs.append(doc)

            transaction.update(ref, {"uploadedDocuments": existing_docs, "updatedAt": firestore.SERVER_TIMESTAMP})

        _txn(db.transaction())
        logger.info("Document upserted in %s: %s (%s)", memory_id, document.get("id"), document.get("name"))

    @staticmethod
    def update_document_status(
        memory_id: str,
        document_id: str,
        status: str,
        additional_data: Optional[dict[str, Any]] = None,
    ) -> None:
        """Transactional status/field update — match by id then by documentName."""
        ref = db.collection(COLLECTION_NAME).document(memory_id)
        extra = dict(additional_data or {})
        document_name = extra.pop("documentName", None)
        cleaned_extra = _remove_none(extra)

        @firestore.transactional
        def _txn(transaction) -> None:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                logger.warning("Memory not found for document status update: %s", memory_id)
                return
            data = snap.to_dict() or {}
            existing_docs: list[dict[str, Any]] = list(data.get("uploadedDocuments") or [])

            idx = next((i for i, d in enumerate(existing_docs) if d.get("id") == document_id), -1)
            if idx < 0 and document_name:
                idx = next((i for i, d in enumerate(existing_docs) if d.get("name") == document_name), -1)
            if idx < 0:
                logger.warning("Document not found in memory: %s", document_id)
                return

            existing_docs[idx] = {
                **_remove_none(existing_docs[idx]),
                "extractionStatus": status,
                **cleaned_extra,
            }
            transaction.update(ref, {"uploadedDocuments": existing_docs, "updatedAt": firestore.SERVER_TIMESTAMP})

        _txn(db.transaction())
        logger.info("Updated document status in %s: %s -> %s", memory_id, document_id, status)

    @staticmethod
    def remove_document(memory_id: str, document_id: str) -> Optional[dict[str, Any]]:
        """Remove a document and return the deleted record (so the caller can
        clean up S3 / OpenAI artifacts), or None if no match."""
        ref = db.collection(COLLECTION_NAME).document(memory_id)

        @firestore.transactional
        def _txn(transaction) -> Optional[dict[str, Any]]:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                return None
            data = snap.to_dict() or {}
            existing_docs: list[dict[str, Any]] = list(data.get("uploadedDocuments") or [])
            removed = next((d for d in existing_docs if d.get("id") == document_id), None)
            if not removed:
                return None
            transaction.update(
                ref,
                {
                    "uploadedDocuments": [d for d in existing_docs if d.get("id") != document_id],
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                },
            )
            return removed

        removed = _txn(db.transaction())
        if removed:
            logger.info("Removed document from memory: %s", document_id)
        else:
            logger.warning("Memory or document not found for removal: %s/%s", memory_id, document_id)
        return removed

    @staticmethod
    def save_geojson_summaries(
        memory_id: str, file_id: str, file_name: str, summaries: list[str]
    ) -> None:
        ref = (
            db.collection(COLLECTION_NAME)
            .document(memory_id)
            .collection("geojson_summaries")
            .document(file_id)
        )
        ref.set(
            {
                "fileId": file_id,
                "fileName": file_name,
                "summaries": summaries,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        logger.info("Saved %d geo-context summaries (fileId: %s)", len(summaries), file_id)
