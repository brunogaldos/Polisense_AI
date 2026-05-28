"""OpenAI vector store — Python port of openaiVectorStoreService.ts.

Reuses the SAME Firestore project as the Node backend; vectorStoreId is stored
on the conversation doc so both backends resolve the same store. All methods are
synchronous (the OpenAI SDK call is blocking) — call them via asyncio.to_thread
from async handlers.
"""

import logging
import os
import threading
import time
from typing import Optional

from firebase_admin import firestore

from app.config.firebase import db

logger = logging.getLogger(__name__)

_COLLECTION = "chatbot_memories"


class OpenAIVectorStoreService:
    _client = None

    # Process-local serialisation of vector-store creation per conversation —
    # mirrors the Node `processLocks` Map. Without it, a multi-file drag-drop can
    # create several stores in one process before Firestore is written; the
    # Firestore compare-and-set below is the cross-process backstop.
    _locks_guard = threading.Lock()
    _process_locks: dict[str, threading.Lock] = {}

    @classmethod
    def _get_client(cls):
        if cls._client is None:
            from openai import OpenAI

            api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_MODEL_API_KEY")
            if not api_key:
                raise RuntimeError("OPENAI_API_KEY is not set")
            cls._client = OpenAI(api_key=api_key)
        return cls._client

    @classmethod
    def _lock_for(cls, memory_id: str) -> threading.Lock:
        with cls._locks_guard:
            lock = cls._process_locks.get(memory_id)
            if lock is None:
                lock = threading.Lock()
                cls._process_locks[memory_id] = lock
            return lock

    @classmethod
    def get_or_create_vector_store(cls, memory_id: str) -> str:
        """Get the existing vectorStoreId for a conversation, or create one.
        Race-safe under concurrent uploads (process-local lock + Firestore
        compare-and-set; the loser of a cross-process race deletes its orphan)."""
        with cls._lock_for(memory_id):
            return cls._create_vector_store_race_safe(memory_id)

    @classmethod
    def _create_vector_store_race_safe(cls, memory_id: str) -> str:
        ref = db.collection(_COLLECTION).document(memory_id)

        # Fast path: already created.
        snap = ref.get()
        if snap.exists and (snap.to_dict() or {}).get("vectorStoreId"):
            vs_id = (snap.to_dict() or {})["vectorStoreId"]
            logger.info("Reusing vector store %s for conversation %s", vs_id, memory_id)
            return vs_id

        logger.info("Creating new OpenAI vector store for conversation %s", memory_id)
        vs = cls._get_client().vector_stores.create(
            name=f"policy-aix-{memory_id}",
            expires_after={"anchor": "last_active_at", "days": 30},
        )
        logger.info("Created vector store %s for conversation %s", vs.id, memory_id)

        # Compare-and-set: if another instance won the race, use their id and
        # delete ours to avoid orphan cost.
        @firestore.transactional
        def _txn(transaction) -> dict:
            re_snap = ref.get(transaction=transaction)
            existing = (re_snap.to_dict() or {}).get("vectorStoreId") if re_snap.exists else None
            if existing:
                return {"id": existing, "won_race": False}
            if re_snap.exists:
                transaction.update(ref, {"vectorStoreId": vs.id, "updatedAt": firestore.SERVER_TIMESTAMP})
            else:
                transaction.set(
                    ref,
                    {
                        "memoryId": memory_id,
                        "vectorStoreId": vs.id,
                        "chatLog": [],
                        "stages": {},
                        "totalCost": 0,
                        "currentStage": "chatbot-conversation",
                        "timeStart": firestore.SERVER_TIMESTAMP,
                        "createdAt": firestore.SERVER_TIMESTAMP,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                )
            return {"id": vs.id, "won_race": True}

        finalised = _txn(db.transaction())
        if not finalised["won_race"]:
            logger.warning(
                "Lost vector-store creation race for %s — cleaning up orphan %s", memory_id, vs.id
            )
            try:
                cls._get_client().vector_stores.delete(vs.id)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not delete orphan vector store %s: %s", vs.id, e)
        return finalised["id"]

    @classmethod
    def upload_file_to_vector_store(
        cls,
        file_buffer: bytes,
        file_name: str,
        vector_store_id: str,
        mime_type: str = "text/plain",
        max_retries: int = 4,
        chunking_strategy: Optional[dict] = None,
    ) -> dict:
        """Upload a file buffer to a vector store. Without chunking_strategy uses
        the upload_and_poll helper (OpenAI default `auto` chunking); with one,
        does the manual three-step upload (the helper drops chunking opts)."""
        client = cls._get_client()
        logger.info(
            "Uploading %r (%d bytes, %s) to vector store %s%s",
            file_name,
            len(file_buffer),
            mime_type,
            vector_store_id,
            " [static chunking]" if chunking_strategy else "",
        )

        last_error: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                # The SDK accepts a (filename, bytes, mimetype) tuple as `file`.
                file_tuple = (file_name, file_buffer, mime_type)
                if chunking_strategy:
                    vs_file = cls._upload_with_chunking_strategy(
                        file_tuple, vector_store_id, chunking_strategy
                    )
                else:
                    # NOTE: the Node version wraps each attempt in a 90s hard
                    # timeout via Promise.race; the SDK's upload_and_poll has its
                    # own polling but no total cap. Left as-is for parity of
                    # behaviour; revisit if a stalled pipeline pins a worker.
                    vs_file = client.vector_stores.files.upload_and_poll(
                        vector_store_id=vector_store_id, file=file_tuple
                    )

                status = getattr(vs_file, "status", None)
                logger.info("Vector store file status: %s (id: %s)", status, vs_file.id)
                if status == "failed":
                    err = getattr(vs_file, "last_error", None)
                    raise RuntimeError(
                        f"Vector store file processing failed: {getattr(err, 'message', status)}"
                    )
                logger.info("File indexed in vector store %s: %s", vector_store_id, vs_file.id)
                return {"openaiFileId": vs_file.id}

            except Exception as err:  # noqa: BLE001
                last_error = err
                status_code = getattr(err, "status_code", None) or getattr(err, "status", None)
                msg = str(err)
                is_404 = status_code == 404 or "404" in msg
                is_timeout = "timed out" in msg
                is_retryable = (
                    is_404
                    or is_timeout
                    or status_code == 429
                    or (isinstance(status_code, int) and status_code >= 500)
                )
                if is_retryable and attempt < max_retries:
                    delay = attempt * 3
                    logger.warning(
                        "Upload attempt %d/%d failed (%s), retrying in %ds",
                        attempt,
                        max_retries,
                        status_code or msg,
                        delay,
                    )
                    time.sleep(delay)
                    continue
                raise

        raise last_error  # type: ignore[misc]

    @classmethod
    def _upload_with_chunking_strategy(
        cls, file_tuple, vector_store_id: str, chunking_strategy: dict
    ) -> object:
        """Three-step upload when an explicit chunking_strategy is needed —
        upload_and_poll doesn't forward chunking opts to files.create."""
        client = cls._get_client()
        file_info = client.files.create(file=file_tuple, purpose="assistants")
        vs_file = client.vector_stores.files.create(
            vector_store_id=vector_store_id,
            file_id=file_info.id,
            chunking_strategy=chunking_strategy,
        )
        return client.vector_stores.files.poll(vs_file.id, vector_store_id=vector_store_id)

    @classmethod
    def delete_vector_store(cls, vector_store_id: str) -> None:
        """Delete an entire vector store (files inside are auto-removed). Used as
        the backstop when a whole conversation is deleted."""
        cls._get_client().vector_stores.delete(vector_store_id)

    @classmethod
    def delete_file_artifacts(
        cls,
        vector_store_id: Optional[str] = None,
        vector_store_file_id: Optional[str] = None,
        attachable_file_id: Optional[str] = None,
    ) -> None:
        """Best-effort cleanup of OpenAI Files + vector-store references for a
        deleted document. Each step is independently try/except'd — partial
        failure must not block the caller (the Firestore record is already gone)."""
        client = cls._get_client()

        if vector_store_id and vector_store_file_id:
            try:
                client.vector_stores.files.delete(
                    vector_store_file_id, vector_store_id=vector_store_id
                )
                logger.info("Detached %s from vector store %s", vector_store_file_id, vector_store_id)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not detach file from vector store: %s", e)

        if vector_store_file_id:
            try:
                client.files.delete(vector_store_file_id)
                logger.info("Deleted file %s", vector_store_file_id)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not delete file %s: %s", vector_store_file_id, e)

        if attachable_file_id and attachable_file_id != vector_store_file_id:
            try:
                client.files.delete(attachable_file_id)
                logger.info("Deleted attachable file %s", attachable_file_id)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not delete attachable file %s: %s", attachable_file_id, e)
