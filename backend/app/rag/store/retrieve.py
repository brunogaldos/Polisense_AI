"""BM25 / vector / hybrid retrieval with optional reranking. Ported from
backend-mini, extended with a mandatory-when-provided memoryId/documentId filter
so a query only ever sees chunks from its own conversation.

CLI (standalone validation):
  python -m app.rag.store.retrieve --query "..." --memory-id demo
"""
import argparse

try:
    from weaviate.classes.query import Filter, MetadataQuery
except ImportError:
    Filter = MetadataQuery = None  # weaviate not installed; retrieve() raises on call

from app.rag.config import COLLECTION_NAME
from app.rag.embedder import Embedder
from app.rag.reranker import Reranker
from app.rag.store.config import get_client
from app.rag.store.schema import RETRIEVE_PROPS as _PROPS


def _to_record(obj) -> dict:
    p = obj.properties
    return {
        "compressedContent": p.get("compressedContent", ""),
        "title":             p.get("title", ""),
        "chunkIndex":        p.get("chunkIndex", 0),
        "chapterIndex":      p.get("chapterIndex", 0),
        "page_number":       p.get("pageNumber", 0),
        "shortSummary":      p.get("shortSummary", ""),
        "fullSummary":       p.get("fullSummary", ""),
        "chunkId":           p.get("chunkId", ""),
        "memoryId":          p.get("memoryId", ""),
        "documentId":        p.get("documentId", ""),
        "_id":               str(obj.uuid),
        "_score":            obj.metadata.score if obj.metadata else None,
    }


def _build_filter(memory_id: str | None, document_id: str | None):
    clauses = []
    if memory_id is not None:
        clauses.append(Filter.by_property("memoryId").equal(memory_id))
    if document_id is not None:
        clauses.append(Filter.by_property("documentId").equal(document_id))
    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else Filter.all_of(clauses)


def _bm25(collection, query, limit, filters):
    resp = collection.query.bm25(
        query=query, limit=limit, filters=filters,
        return_properties=_PROPS, return_metadata=MetadataQuery(score=True),
    )
    return [_to_record(o) for o in resp.objects]


def _vector(collection, vector, limit, filters):
    resp = collection.query.near_vector(
        near_vector=vector, limit=limit, filters=filters,
        return_properties=_PROPS, return_metadata=MetadataQuery(distance=True),
    )
    return [_to_record(o) for o in resp.objects]


def _hybrid(collection, query, vector, limit, filters):
    resp = collection.query.hybrid(
        query=query, vector=vector, limit=limit, filters=filters,
        return_properties=_PROPS, return_metadata=MetadataQuery(score=True),
    )
    return [_to_record(o) for o in resp.objects]


def retrieve(
    query: str,
    memory_id: str | None = None,
    document_id: str | None = None,
    mode: str = "hybrid",
    top_k: int = 5,
    candidates: int = 20,
    rerank: bool = True,
) -> list[dict]:
    """Retrieve relevant chunks from Weaviate, scoped to a conversation/document."""
    if Filter is None:
        raise ImportError("weaviate-client is not installed. Run: pip install weaviate-client")
    embedder = Embedder()
    vector = embedder.embed(query)
    filters = _build_filter(memory_id, document_id)

    client = get_client()
    try:
        if not client.collections.exists(COLLECTION_NAME):
            return []
        collection = client.collections.get(COLLECTION_NAME)
        if mode == "bm25":
            results = _bm25(collection, query, candidates, filters)
        elif mode == "vector":
            results = _vector(collection, vector, candidates, filters)
        else:
            results = _hybrid(collection, query, vector, candidates, filters)
    finally:
        client.close()

    if rerank and results:
        results = Reranker().rerank(query, results, top_k)
    else:
        results = results[:top_k]

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--memory-id")
    parser.add_argument("--document-id")
    parser.add_argument("--mode", choices=["bm25", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--candidates", type=int, default=20)
    parser.add_argument("--no-rerank", action="store_true")
    args = parser.parse_args()

    results = retrieve(
        args.query, args.memory_id, args.document_id,
        args.mode, args.top_k, args.candidates, not args.no_rerank,
    )
    for i, chunk in enumerate(results, 1):
        score = chunk.get("_rerank_score") or chunk.get("_score")
        score_str = f" (score={score:.4f})" if score is not None else ""
        print(f"[{i}] {chunk['title']}{score_str}")
        print(f"    {chunk['compressedContent'][:200]}...")
        print()
