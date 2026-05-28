"""Local RAG stack — ported from prototype/backend-mini.

Self-contained local retrieval-augmented-generation building blocks:
  • embedder   — sentence-transformers (CPU) client-side embeddings
  • reranker   — BGE cross-encoder reranking
  • chunking   — structure-aware chunk splitting
  • ocr        — Docling layout-aware PDF parsing
  • store/     — Weaviate ingest + retrieve (per-conversation scoped)

Milestone A: this package is importable and runnable standalone (via the
store CLIs) but is NOT yet wired into the chatbot or ingestion routes — no
existing behaviour changes until a later milestone flips the provider flags.
"""
