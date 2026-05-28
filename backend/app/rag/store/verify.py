"""Verify Weaviate collection contents. Ported from backend-mini.

CLI (standalone validation):
  python -m app.rag.store.verify
  python -m app.rag.store.verify --limit 20
"""
import argparse
import math

from app.rag.config import COLLECTION_NAME
from app.rag.store.config import get_client


def verify(limit: int = 10):
    client = get_client()
    try:
        existing = [c.name for c in client.collections.list_all().values()]
        print(f"Collections in Weaviate: {existing or '(none)'}")

        if COLLECTION_NAME not in existing:
            print(f"Collection '{COLLECTION_NAME}' not found — run ingest first.")
            return

        collection = client.collections.get(COLLECTION_NAME)
        response = collection.query.fetch_objects(limit=limit, include_vector=True)
        objs = response.objects

        print(f"Chunk count returned: {len(objs)}")
        for i, obj in enumerate(objs):
            props = obj.properties
            vec = obj.vector.get("default") if obj.vector else None
            line = (
                f"[{i+1}] mem={props.get('memoryId')!r} doc={props.get('documentId')!r} "
                f"title={props.get('title')!r}, chunkIndex={props.get('chunkIndex')}"
            )
            if vec is not None and i < 5:
                norm = math.sqrt(sum(x * x for x in vec))
                line += f", dim={len(vec)}, L2_norm={norm:.4f}"
            print(line)
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    verify(args.limit)
