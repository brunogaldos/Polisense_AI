"""Embed chunks and write them to Weaviate. Ported from backend-mini, extended
to stamp a conversation (memoryId) and document (documentId) onto each chunk so
retrieval can be scoped per conversation.

CLI (standalone validation):
  python -m app.rag.store.ingest --chunks path/to/chunks.json --memory-id demo
  python -m app.rag.store.ingest --folder data/rag_cache --memory-id demo
"""
import argparse
import json
import time
from pathlib import Path

from weaviate.classes.config import Configure, Property
from weaviate.util import generate_uuid5

from app.rag.config import COLLECTION_NAME, cache_dir
from app.rag.embedder import Embedder
from app.rag.store.config import get_client
from app.rag.store.schema import CHUNK_SCHEMA


def ensure_collection(client):
    if client.collections.exists(COLLECTION_NAME):
        return
    client.collections.create(
        name=COLLECTION_NAME,
        properties=[Property(name=k, data_type=v[0]) for k, v in CHUNK_SCHEMA.items()],
        vector_config=Configure.Vectors.self_provided(),
    )


def _stamp(chunks: list[dict], memory_id: str | None, document_id: str | None) -> None:
    """Inject scoping ids into each chunk's metadata in place."""
    for c in chunks:
        meta = c.setdefault("metadata", {})
        if memory_id is not None:
            meta["memoryId"] = memory_id
        if document_id is not None:
            meta["document_id"] = document_id


def ingest_chunks(
    chunks: list[dict],
    memory_id: str | None = None,
    document_id: str | None = None,
) -> int:
    """Embed and write a list of chunk dicts to Weaviate. Returns count ingested.

    UUIDv5 is derived from chunk["id"], so re-ingesting the same chunk id is
    idempotent (upsert). Pass memory_id to scope chunks to a conversation.
    """
    if not chunks:
        return 0
    _stamp(chunks, memory_id, document_id)
    print(f"Embedding {len(chunks)} chunks...")
    t0 = time.time()
    embedder = Embedder()
    vectors = embedder.embed_batch([c["text"] for c in chunks])
    client = get_client()
    try:
        ensure_collection(client)
        collection = client.collections.get(COLLECTION_NAME)
        with collection.batch.dynamic() as batch:
            for i, (chunk, vector) in enumerate(zip(chunks, vectors), 1):
                meta = chunk.get("metadata", {})
                props = {k: fn(meta, chunk) for k, (_, fn) in CHUNK_SCHEMA.items()}
                doc = meta.get("document_id", meta.get("paper_id", "?"))
                section = meta.get("section", "")
                s_idx = meta.get("section_index", 0)
                p_idx = meta.get("part_index", 0)
                print(f"  [{i:>4}/{len(chunks)}] {doc}  |  {section!r}  idx={s_idx}.{p_idx}")
                batch.add_object(
                    uuid=generate_uuid5(chunk["id"]),
                    properties=props,
                    vector=vector,
                )
    finally:
        client.close()
    print(f"\nDone — {len(chunks)} chunks ingested in {time.time() - t0:.1f}s")
    return len(chunks)


def delete_by_memory(memory_id: str) -> None:
    """Remove all chunks for a conversation (used on conversation delete)."""
    from weaviate.classes.query import Filter

    client = get_client()
    try:
        if not client.collections.exists(COLLECTION_NAME):
            return
        collection = client.collections.get(COLLECTION_NAME)
        collection.data.delete_many(
            where=Filter.by_property("memoryId").equal(memory_id)
        )
    finally:
        client.close()


def ingest_file(chunks_path: str | Path, memory_id: str | None = None,
                document_id: str | None = None) -> int:
    with open(chunks_path, encoding="utf-8") as f:
        chunks = json.load(f)
    print(f"Loaded {len(chunks)} chunks from {Path(chunks_path).name}")
    return ingest_chunks(chunks, memory_id, document_id)


def ingest_folder(folder: str | Path | None = None, memory_id: str | None = None) -> int:
    folder = Path(folder) if folder else cache_dir()
    paths = sorted(folder.glob("*_chunks.json"))
    if not paths:
        raise FileNotFoundError(f"No *_chunks.json found in {folder}")
    all_chunks: list[dict] = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            all_chunks.extend(json.load(f))
        print(f"  Loaded {p.name}")
    print(f"Total chunks: {len(all_chunks)}")
    return ingest_chunks(all_chunks, memory_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest chunks into Weaviate")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--chunks", help="Path to a single *_chunks.json file")
    group.add_argument("--folder", help="Folder containing *_chunks.json files")
    group.add_argument("--all", action="store_true",
                       help="Ingest all *_chunks.json from the RAG cache dir")
    parser.add_argument("--memory-id", help="Scope ingested chunks to this conversation")
    parser.add_argument("--document-id", help="Scope to this document id")
    args = parser.parse_args()

    if args.all:
        ingest_folder(memory_id=args.memory_id)
    elif args.folder:
        ingest_folder(args.folder, memory_id=args.memory_id)
    else:
        ingest_file(args.chunks, args.memory_id, args.document_id)
