"""Configuration for the local RAG stack — env-driven, no import-time side effects.

Ported from backend-mini's pipeline/config.py, but decoupled from that project's
materials/ + data/parsed_papers/ layout. Paths are rooted at the backend dir and
created lazily (see cache_dir()) so importing this in the web process is free.
"""
import os
from pathlib import Path

# backend/app/rag/config.py → parents[2] == backend/
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def cache_dir() -> Path:
    """OCR/parse cache dir, created on first use. Override with RAG_CACHE_DIR."""
    d = Path(os.getenv("RAG_CACHE_DIR") or (BACKEND_ROOT / "data" / "rag_cache"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def figure_dir() -> Path:
    d = cache_dir() / "figures"
    d.mkdir(parents=True, exist_ok=True)
    return d


# Weaviate — defaults match the docker-compose host mapping (8090→8080) so the
# store CLIs work from the host with no env set. In-container, compose sets
# WEAVIATE_HOST=weaviate and WEAVIATE_PORT=8080.
WEAVIATE_HOST = os.getenv("WEAVIATE_HOST", "localhost")
WEAVIATE_PORT = int(os.getenv("WEAVIATE_PORT", "8090"))
COLLECTION_NAME = os.getenv("RAG_COLLECTION_NAME", "RagDocumentChunk")

# Models
BGE_MODEL_NAME = os.getenv("BGE_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
RERANKER_MODEL_NAME = os.getenv("RERANKER_MODEL_NAME", "BAAI/bge-reranker-v2-m3")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "32"))
EMBED_DEVICE = os.getenv("RAG_EMBED_DEVICE", "cpu")
