"""Weaviate collection schema. Ported from backend-mini, extended for Polisense.

Two fields added vs. backend-mini — memoryId and documentId — so chunks can be
filtered to a single conversation (and optionally a single document) at query
time. This preserves the per-conversation isolation that Polisense's OpenAI
vector stores provide today. Every retrieve() must filter by memoryId.
"""
from weaviate.classes.config import DataType

# Each entry: field_name → (weaviate_type, extractor_fn(meta, chunk))
# meta = chunk["metadata"], chunk = raw JSON chunk dict
CHUNK_SCHEMA = {
    "chunkId":           (DataType.TEXT, lambda m, c: c["id"]),
    "memoryId":          (DataType.TEXT, lambda m, c: m.get("memoryId", "")),
    "documentId":        (DataType.TEXT, lambda m, c: m.get("document_id", m.get("documentId", ""))),
    "title":             (DataType.TEXT, lambda m, c: m.get("section", m.get("title", ""))),
    "chunkIndex":        (DataType.INT,  lambda m, c: m.get("section_index", m.get("part_index", 0))),
    "chapterIndex":      (DataType.INT,  lambda m, c: m.get("part_index", 0)),
    "compressedContent": (DataType.TEXT, lambda m, c: c["text"]),
    "pageNumber":        (DataType.INT,  lambda m, c: m.get("page_number", 0)),
    "shortSummary":      (DataType.TEXT, lambda m, c: ""),
    "fullSummary":       (DataType.TEXT, lambda m, c: ""),
}

RETRIEVE_PROPS = [
    "chunkId", "memoryId", "documentId", "title", "chunkIndex", "chapterIndex",
    "compressedContent", "pageNumber", "shortSummary", "fullSummary",
]
