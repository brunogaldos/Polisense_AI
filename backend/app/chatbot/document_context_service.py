"""Per-conversation document context — supplies RAG corpus name and document
names to the chatbot for retrieval and system-prompt grounding."""

import asyncio
import logging
from typing import Any, Optional

from app.services.firestore_memory_service import FirestoreMemoryService

logger = logging.getLogger("polisense.chatbot")


class DocumentContextService:
    @staticmethod
    async def build_for_conversation(memory_id: Optional[str]) -> dict[str, Any]:
        empty = {
            "ragCorpusName": None,
            "documentNames": [],
            "hasReadyDocuments": False,
        }
        if not memory_id:
            return empty

        rag_corpus_name, documents = await asyncio.gather(
            asyncio.to_thread(FirestoreMemoryService.get_rag_corpus_name, memory_id),
            asyncio.to_thread(FirestoreMemoryService.get_conversation_documents, memory_id),
        )

        ready_docs = [d for d in documents if d.get("extractionStatus") == "rag_ready"]
        document_names = [d.get("name") for d in ready_docs if d.get("name")]

        return {
            "ragCorpusName": rag_corpus_name,
            "documentNames": document_names,
            "hasReadyDocuments": bool(ready_docs),
        }
