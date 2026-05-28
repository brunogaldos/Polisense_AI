"""Shadow retrieval (Milestone C).

On a RAG turn, run the local Weaviate retrieve() alongside the real OpenAI
answer — purely to observe. Nothing here touches the response streamed to the
user; it logs a one-line summary and appends a JSONL record under the RAG cache
dir for offline tuning of mode / top_k / reranker before retrieval is flipped.

Gated by RAG_SHADOW (default off). Only meaningful once RAG_DUAL_WRITE has been
populating the local store. All work is blocking — call via asyncio.to_thread.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone

from app.rag.config import cache_dir
from app.rag.store.retrieve import retrieve

logger = logging.getLogger("polisense.rag")

SHADOW_LOG = "shadow_log.jsonl"


def shadow_enabled() -> bool:
    return (os.getenv("RAG_SHADOW") or "").strip().lower() in ("1", "true", "yes", "on")


def record_shadow(query: str, memory_id: str) -> dict:
    """Run local retrieval and return a structured comparison record."""
    mode = os.getenv("RAG_SHADOW_MODE", "hybrid")
    top_k = int(os.getenv("RAG_SHADOW_TOP_K", "8"))
    candidates = int(os.getenv("RAG_SHADOW_CANDIDATES", "30"))

    t0 = time.time()
    hits = retrieve(query, memory_id=memory_id, mode=mode, top_k=top_k, candidates=candidates)
    latency_ms = round((time.time() - t0) * 1000, 1)

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "memoryId": memory_id,
        "query": query,
        "mode": mode,
        "top_k": top_k,
        "candidates": candidates,
        "latency_ms": latency_ms,
        "count": len(hits),
        "hits": [
            {
                "title": h.get("title", ""),
                "page": h.get("page_number", 0),
                "documentId": h.get("documentId", ""),
                "score": h.get("_rerank_score") if h.get("_rerank_score") is not None else h.get("_score"),
                "preview": (h.get("compressedContent", "") or "")[:160],
            }
            for h in hits
        ],
    }


def safe_shadow(query: str, memory_id: str) -> None:
    """Best-effort: record + log + append JSONL. Never raises."""
    if not (query and memory_id):
        return
    try:
        rec = record_shadow(query, memory_id)
        top = rec["hits"][0] if rec["hits"] else None
        logger.info(
            "SHADOW retrieval mem=%s q=%r -> %d hits in %sms; top=%s",
            memory_id,
            query[:80],
            rec["count"],
            rec["latency_ms"],
            f"{top['title'][:50]!r}@{top['score']:.3f}" if top and top["score"] is not None else "none",
        )
        try:
            path = cache_dir() / SHADOW_LOG
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception as e:  # noqa: BLE001
            logger.warning("Shadow JSONL append failed (non-fatal): %s", e)
    except Exception as e:  # noqa: BLE001
        logger.warning("Shadow retrieval failed for mem=%s (non-fatal): %s", memory_id, e)
