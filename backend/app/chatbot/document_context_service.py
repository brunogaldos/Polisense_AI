"""Per-conversation multimodal inputs — port of documentContextService.ts.

Derives, from Firestore only (no OpenAI calls):
  - vectorStoreId      → feeds the hosted file_search tool
  - attachableFileIds  → OpenAI Files ids attached to the user message as
                         input_file / input_image for visual reasoning
  - imageFileIds       → subset of the above that are images
  - documentNames      → human-readable list for the system prompt
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Optional

from app.services.firestore_memory_service import FirestoreMemoryService

logger = logging.getLogger("polisense.chatbot")

MAX_ATTACHED_FILES = int(os.getenv("MULTIMODAL_MAX_ATTACHED_FILES") or 4)
MAX_ATTACHED_BYTES = int(os.getenv("MULTIMODAL_MAX_ATTACHED_BYTES") or 12 * 1024 * 1024)


def _is_pdf_doc(d: dict[str, Any]) -> bool:
    t = (d.get("type") or "").lower()
    name = (d.get("name") or "").lower()
    return t == "application/pdf" or name.endswith(".pdf")


def _upload_time_ms(d: dict[str, Any]) -> float:
    t = d.get("uploadTime")
    if not t:
        return 0.0
    if isinstance(t, datetime):
        return t.timestamp() * 1000
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp() * 1000
    except (ValueError, TypeError):
        return 0.0


class DocumentContextService:
    @staticmethod
    async def build_for_conversation(memory_id: Optional[str]) -> dict[str, Any]:
        empty = {
            "vectorStoreId": None,
            "attachableFileIds": [],
            "imageFileIds": [],
            "documentNames": [],
            "hasReadyDocuments": False,
        }
        if not memory_id:
            return empty

        vector_store_id, documents = await asyncio.gather(
            asyncio.to_thread(FirestoreMemoryService.get_vector_store_id, memory_id),
            asyncio.to_thread(FirestoreMemoryService.get_conversation_documents, memory_id),
        )

        # Choose which file id (if any) to attach as input_file/input_image.
        # Guard against attaching a derived .md (from spreadsheet/image/GeoJSON) —
        # those live in the vector store and are reached via file_search.
        #   1. attachableFileId  — explicit original-bytes upload. Authoritative.
        #   2. openaiFileId (PDFs only) — safe only when the vector-store file IS
        #      the original bytes (legacy PDF happy path).
        #   3. otherwise — no attachment; rely on file_search.
        # Images MUST have attachableFileId (openaiFileId points at OCR'd .md).
        ready: list[dict[str, Any]] = []
        for d in documents:
            is_image = (d.get("type") or "").lower().startswith("image/")
            pdf_fallback = d.get("openaiFileId") if (not is_image and _is_pdf_doc(d)) else None
            attach_id = d.get("attachableFileId") if is_image else (d.get("attachableFileId") or pdf_fallback)
            if d.get("extractionStatus") == "rag_ready" and attach_id:
                ready.append({"doc": d, "attachId": attach_id, "isImage": is_image})

        ordered = sorted(ready, key=lambda e: _upload_time_ms(e["doc"]), reverse=True)

        attachable: list[dict[str, Any]] = []
        bytes_used = 0
        for entry in ordered:
            if len(attachable) >= MAX_ATTACHED_FILES:
                break
            size = entry["doc"].get("size") or 0
            if size > 0 and bytes_used + size > MAX_ATTACHED_BYTES:
                if attachable:  # let a single oversized doc through if it's first
                    continue
            attachable.append(entry)
            bytes_used += size

        if len(ordered) > len(attachable):
            logger.info(
                "Attachment budget hit: %d/%d files attached (%.1f MB); rest via file_search",
                len(attachable),
                len(ordered),
                bytes_used / 1024 / 1024,
            )

        return {
            "vectorStoreId": vector_store_id,
            "attachableFileIds": [a["attachId"] for a in attachable],
            "imageFileIds": [a["attachId"] for a in attachable if a["isImage"]],
            "documentNames": [a["doc"].get("name") for a in attachable if a["doc"].get("name")],
            "hasReadyDocuments": bool(ready),
        }
