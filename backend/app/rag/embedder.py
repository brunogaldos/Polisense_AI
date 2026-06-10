"""Client-side embeddings via sentence-transformers. Ported from backend-mini.

CPU by default (override with RAG_EMBED_DEVICE). The model is a process-local
singleton; the first call downloads weights from HuggingFace if not cached.
These calls are blocking/CPU-bound — call them via asyncio.to_thread from the
async backend so they don't block the event loop.
"""
from app.rag.config import BGE_MODEL_NAME, BATCH_SIZE, EMBED_DEVICE


class Embedder:
    _model = None

    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(BGE_MODEL_NAME, device=EMBED_DEVICE)
        return self._model

    def embed(self, text: str) -> list[float]:
        return self._get_model().encode(text, normalize_embeddings=True).tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return self._get_model().encode(
            texts, batch_size=BATCH_SIZE, normalize_embeddings=True, show_progress_bar=True
        ).tolist()
