"""Vertex AI RAG Engine — replaces OpenAI Vector Store for document indexing.

All blocking SDK calls are synchronous — call via asyncio.to_thread from async
handlers. Credentials come from GEMINI_SERVICE_ACCOUNT_KEY (falls back to
GOOGLE_APPLICATION_CREDENTIALS). The corpus resource name is stored in Firestore
at the conversation level under 'ragCorpusName'.
"""

import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

from firebase_admin import firestore

from app.config.firebase import db

logger = logging.getLogger("polisense.rag")

_COLLECTION = "chatbot_memories"


def _get_vertexai_credentials():
    sa_file = os.getenv("GEMINI_SERVICE_ACCOUNT_KEY") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not sa_file:
        return None, None
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(
        sa_file, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        with open(sa_file) as f:
            project_id = json.load(f).get("project_id")
    return creds, project_id


def _init_vertexai():
    """Initialize Vertex AI SDK with service account credentials."""
    import vertexai
    creds, project_id = _get_vertexai_credentials()
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    vertexai.init(project=project_id, location=location, credentials=creds)
    return project_id, location


class VertexRagService:
    _locks_guard = threading.Lock()
    _process_locks: dict[str, threading.Lock] = {}

    @classmethod
    def _lock_for(cls, memory_id: str) -> threading.Lock:
        with cls._locks_guard:
            lock = cls._process_locks.get(memory_id)
            if lock is None:
                lock = threading.Lock()
                cls._process_locks[memory_id] = lock
            return lock

    @classmethod
    def get_or_create_corpus(cls, memory_id: str) -> str:
        """Get or create a RAG Corpus for this conversation.
        Race-safe: process-local lock + Firestore compare-and-set.
        Returns the corpus resource name stored under ragCorpusName."""
        with cls._lock_for(memory_id):
            return cls._get_or_create_race_safe(memory_id)

    @classmethod
    def _get_or_create_race_safe(cls, memory_id: str) -> str:
        from vertexai import rag

        ref = db.collection(_COLLECTION).document(memory_id)

        # Fast path: already created.
        snap = ref.get()
        existing_name = (snap.to_dict() or {}).get("ragCorpusName") if snap.exists else None
        if existing_name:
            logger.info("Reusing RAG corpus %s for conversation %s", existing_name, memory_id)
            return existing_name

        _init_vertexai()
        logger.info("Creating Vertex AI RAG corpus for conversation %s", memory_id)
        corpus = rag.create_corpus(display_name=f"polisense-{memory_id}")
        logger.info("Created RAG corpus: %s", corpus.name)

        @firestore.transactional
        def _txn(transaction) -> dict:
            re_snap = ref.get(transaction=transaction)
            winner = (re_snap.to_dict() or {}).get("ragCorpusName") if re_snap.exists else None
            if winner:
                return {"name": winner, "won": False}
            if re_snap.exists:
                transaction.update(ref, {
                    "ragCorpusName": corpus.name,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                })
            else:
                transaction.set(ref, {
                    "memoryId": memory_id,
                    "ragCorpusName": corpus.name,
                    "chatLog": [],
                    "stages": {},
                    "totalCost": 0,
                    "currentStage": "chatbot-conversation",
                    "timeStart": firestore.SERVER_TIMESTAMP,
                    "createdAt": firestore.SERVER_TIMESTAMP,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                })
            return {"name": corpus.name, "won": True}

        finalised = _txn(db.transaction())
        if not finalised["won"]:
            logger.warning("Lost corpus creation race for %s — deleting orphan %s", memory_id, corpus.name)
            try:
                rag.delete_corpus(name=corpus.name)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not delete orphan corpus %s: %s", corpus.name, e)
        return finalised["name"]

    @classmethod
    def upload_file_to_corpus(
        cls,
        content: bytes,
        file_name: str,
        corpus_name: str,
        mime_type: str = "text/plain",
    ) -> dict:
        """Upload content bytes to a RAG Corpus. Returns {ragFileId: resource_name}."""
        from vertexai import rag

        _init_vertexai()
        suffix = Path(file_name).suffix or ".txt"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            logger.info("Uploading %r (%d bytes) to RAG corpus %s", file_name, len(content), corpus_name)
            rag_file = rag.upload_file(
                corpus_name=corpus_name,
                path=tmp_path,
                display_name=file_name,
            )
            logger.info("Uploaded to RAG corpus: %s", rag_file.name)
            return {"ragFileId": rag_file.name}
        finally:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass

    @classmethod
    def delete_corpus(cls, corpus_name: str) -> None:
        """Delete an entire RAG Corpus and all its files."""
        from vertexai import rag

        _init_vertexai()
        try:
            rag.delete_corpus(name=corpus_name)
            logger.info("Deleted RAG corpus: %s", corpus_name)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to delete RAG corpus %s: %s", corpus_name, e)

    @classmethod
    def delete_file_artifacts(
        cls,
        corpus_name: Optional[str] = None,
        rag_file_id: Optional[str] = None,
    ) -> None:
        """Best-effort cleanup of a single RAG file. corpus_name is unused by
        the API (file id is globally unique) but kept for call-site symmetry."""
        if not rag_file_id:
            return
        from vertexai import rag

        _init_vertexai()
        try:
            rag.delete_file(name=rag_file_id)
            logger.info("Deleted RAG file: %s", rag_file_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to delete RAG file %s: %s", rag_file_id, e)

    @classmethod
    def retrieval_query(cls, corpus_name: str, query: str, top_k: int = 10) -> list[dict]:
        """Query a RAG Corpus. Returns list of {title, page_number, compressedContent, score}."""
        from vertexai import rag

        _init_vertexai()
        response = rag.retrieval_query(
            rag_resources=[rag.RagResource(rag_corpus=corpus_name)],
            text=query,
            rag_retrieval_config=rag.RagRetrievalConfig(top_k=top_k),
        )
        chunks: list[dict] = []
        contexts = getattr(getattr(response, "contexts", None), "contexts", None) or []
        for ctx in contexts:
            chunks.append({
                "title": getattr(ctx, "source_display_name", None) or "Document",
                "page_number": 0,
                "compressedContent": getattr(ctx, "text", "") or "",
                "score": getattr(ctx, "score", None),
            })
        return chunks
