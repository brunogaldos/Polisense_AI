"""Dual-write ingestion — parse/chunk/embed a document into the local Weaviate
store alongside the existing OpenAI vector-store path.

Milestone B: these are best-effort, flag-gated (RAG_DUAL_WRITE) side-writes
invoked from the ingestion background tasks. They never raise into the caller —
the OpenAI path remains authoritative until a later milestone flips retrieval.

All work here is blocking (Docling, sentence-transformers) — callers must invoke
via asyncio.to_thread so the event loop stays free.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from app.rag.chunking import build_chunks_from_paper
from app.rag.ocr import ParsedPaper, ParsedSection, parse_pdf
from app.rag.store.ingest import ingest_chunks

logger = logging.getLogger("polisense.rag")


def dual_write_enabled() -> bool:
    return (os.getenv("RAG_DUAL_WRITE") or "").strip().lower() in ("1", "true", "yes", "on")


def ingest_pdf_bytes(
    file_bytes: bytes, file_name: str, memory_id: str, document_id: str
) -> int:
    """Docling-parse a PDF, chunk it, and write to Weaviate. Returns chunk count."""
    stem = Path(file_name).stem or document_id
    # parse_pdf reads from a path and caches by stem; use the document_id as stem
    # so the on-disk parse cache is conversation-unique.
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = Path(tmp) / f"{document_id}.pdf"
        pdf_path.write_bytes(file_bytes)
        paper = parse_pdf(pdf_path)
    # parse_pdf set paper.paper_id to the temp stem (document_id); keep section
    # text but force the document_id for stable, conversation-scoped chunk ids.
    paper.paper_id = stem
    chunks = build_chunks_from_paper(paper, document_id=document_id)
    return ingest_chunks(chunks, memory_id=memory_id, document_id=document_id)


def ingest_markdown(
    markdown: str, file_name: str, memory_id: str, document_id: str
) -> int:
    """Chunk an already-extracted Markdown/text blob (spreadsheets, JSON, GeoJSON
    rich text) and write to Weaviate. Returns chunk count."""
    text = (markdown or "").strip()
    if not text:
        return 0
    title = Path(file_name).stem or document_id
    paper = ParsedPaper(
        paper_id=title,
        sections=[ParsedSection(heading=title, text=text, page_start=1)],
        tables=[],
        figures=[],
        full_markdown=text,
    )
    chunks = build_chunks_from_paper(paper, document_id=document_id)
    return ingest_chunks(chunks, memory_id=memory_id, document_id=document_id)


def safe_dual_write_pdf(file_bytes, file_name, memory_id, document_id) -> None:
    """Best-effort wrapper — logs and swallows any error."""
    try:
        n = ingest_pdf_bytes(file_bytes, file_name, memory_id, document_id)
        logger.info("Dual-write: %d chunks → Weaviate for %r (mem=%s)", n, file_name, memory_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Dual-write (PDF) failed for %r (non-fatal): %s", file_name, e)


def safe_dual_write_markdown(markdown, file_name, memory_id, document_id) -> None:
    try:
        n = ingest_markdown(markdown, file_name, memory_id, document_id)
        logger.info("Dual-write: %d chunks → Weaviate for %r (mem=%s)", n, file_name, memory_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Dual-write (markdown) failed for %r (non-fatal): %s", file_name, e)
