# BE_INGESTION — Document Ingestion Pipeline

Handles PDF, image, spreadsheet, GeoJSON, and JSON uploads. Every format follows the same fire-and-forget pattern: the HTTP handler validates input and returns `202 Accepted` immediately; extraction and indexing run as a detached `asyncio` task and report progress over WebSocket.

---

## Overview

```
Client upload
    │
    ├─ POST /ingest-pdf      (multipart form)
    ├─ POST /ingest-geojson  (JSON body)
    └─ POST /ingest-json     (JSON body)
            │
            ▼
    Validate → generate fileId → asyncio.create_task(...)
            │
            ▼ (background)
    ┌─────────────────────────────────────────────────────┐
    │  WS: extractionProgress { phase: "extracting" }     │
    │  S3: upload original bytes (non-fatal if fails)     │
    │  OpenAI: extract text / index in vector store       │
    │  Firestore: update document status                  │
    │  WS: ragIngestionCompleted  OR  extractionFailed    │
    └─────────────────────────────────────────────────────┘
```

---

## File ID generation

Every uploaded file gets a stable, sortable ID:

```python
def _make_file_id(file_name: str) -> tuple[str, int, str]:
    timestamp = int(datetime.now(UTC).timestamp() * 1000)   # epoch ms
    rand      = base36(round(random() * 1e9))
    sanitized = re.sub(r"[^a-zA-Z0-9.-]", "_", file_name)
    return f"{timestamp}_{rand}_{sanitized}", timestamp, sanitized

# Example: "1748463600000_2gk4j_report_2024.pdf"
```

The same ID is stored in Firestore `uploadedDocuments` and used as the S3 path prefix:
```
uploads/<timestamp>/<sanitized_name>
```

---

## PDF / Image / Spreadsheet (`ingest-pdf`)

### Routing by file type

```
ingest_pdf (multipart: file, memoryId, userId)
    │
    ├─ image/* or .png/.jpg/.webp/.gif
    │       └─► upload original bytes as attachable_file_id
    │           extract text via GPT-4o vision (base64)
    │           upload OCR'd .md to vector store
    │
    ├─ .xlsx / .xlsm / .xltm / .xltx
    │       └─► openpyxl local extraction → Markdown tables
    │           upload .md to vector store (static chunking: 600 tokens, 150 overlap)
    │           attachableFileId = None (spreadsheets can't be visual-attached)
    │
    ├─ .xls / .xlsb
    │       └─► ValueError — not supported, ask user to save as .xlsx
    │
    └─ default (PDF, DOCX, etc.)
            └─► direct vector-store upload (openaiFileId = attachableFileId)
                    │ if "could not be parsed" error:
                    └─► GPT-4o vision OCR fallback
                            └─► upload OCR'd .md to vector store
                                keep original file alive as attachable_file_id
```

---

## PDF extraction (`OpenAIExtractionService`)

### Text-based PDF (fast path)

```python
reader = PdfReader(io.BytesIO(pdf_buffer))
text = "\n".join(page.extract_text() for page in reader.pages)
avg_chars_per_page = len(text) / pages

if avg_chars_per_page >= 80:   # MIN_CHARS_PER_PAGE
    return {"markdown": text, "extractionMethod": "OPENAI"}
```

### Scanned / sparse PDF (vision path)

```python
# Upload to OpenAI Files API
uploaded = client.files.create(file=(name, buffer, "application/pdf"), purpose="user_data")

# Ask GPT-4o to extract text natively
resp = client.responses.create(
    model="gpt-4o",
    input=[{
        "role": "user",
        "content": [
            {"type": "input_file", "file_id": uploaded.id, "detail": "high"},
            {"type": "input_text", "text": "Extract ALL text as clean Markdown..."},
        ]
    }]
)
```

The uploaded file is **kept alive** on success — it becomes the `attachableFileId` so the chatbot can visually inspect the original PDF at chat time.

### Image extraction

```python
b64 = base64.b64encode(image_buffer).decode("ascii")
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Extract all content as Markdown:"},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"}}
        ]
    }]
)
```

---

## Spreadsheet extraction (`OpenAIExtractionService.extract_from_spreadsheet`)

Why local extraction instead of direct vector-store upload: OpenAI's default chunker is text-oriented and can split rows mid-cell, losing the column→value pairing. Local extraction gives deterministic sheet boundaries.

```python
workbook = load_workbook(io.BytesIO(buffer), read_only=True, data_only=True)

for sheet in workbook.worksheets:
    if sheet.sheet_state != "visible": skip
    if _JUNK_SHEET_NAME.match(sheet.title): skip  # config/settings/hidden/etc.

    markdown_table = _render_sheet(sheet)
    # First row → header, rest → body rows
    # Pipe-escaped cells, trailing empties trimmed
```

Limits:
- `SPREADSHEET_MAX_ROWS_PER_SHEET` = 5000 rows (truncated with marker)
- `SPREADSHEET_MAX_MARKDOWN_BYTES` = 8 MB total (remaining sheets skipped with warning)

Uploaded to vector store with `static` chunking strategy: `max_chunk_size_tokens=600`, `chunk_overlap_tokens=150` — tighter than the default to keep full table rows in a single chunk.

---

## GeoJSON ingestion (`ingest-geojson`)

Accepts a `FeatureCollection`. For each feature, extracts:

```python
# Short summary → Firestore geojson_summaries subcollection (max 200 features)
"Feature 1 | type: Polygon | location: 12.04600°S, 77.02800°W | name: Concesion ABC | area: 1200"

# Rich block → vector store for semantic search
"""--- Feature 1 (catastro.geojson) ---
Geometry: Polygon
Location (centroid): 12.04600°S, 77.02800°W
Properties:
  name: Concesion ABC
  area: 1200"""
```

The Firestore summaries (short lines) are read back by `handle_overlap_analysis` and `handle_geospatial_query` at chat time to give the LLM geographic context without a vector search round-trip.

The 200-feature cap on Firestore keeps the document under ~30KB. All features are indexed in the vector store.

---

## JSON ingestion (`ingest-json`)

Two helper functions in `json_converter.py`:

```python
json_to_markdown(data, file_name)
# Recursively converts any JSON structure to readable Markdown:
# - arrays of objects → Markdown table (columns = union of all keys)
# - nested objects → indented sections
# - scalars → key: value lines

json_to_summary_lines(data, file_name)
# Returns a list of one-line strings for Firestore storage:
# ["Record 1: name=Caraveli area=1200 status=active", ...]
```

Markdown goes to the vector store. Summary lines go to `geojson_summaries` (same subcollection as GeoJSON — reused for any structured data).

---

## Vector store upload (`OpenAIVectorStoreService.upload_file_to_vector_store`)

```python
# Default (auto chunking via SDK helper)
vs_file = client.vector_stores.files.upload_and_poll(
    vector_store_id=vector_store_id,
    file=(file_name, buffer, mime_type)
)

# With explicit chunking strategy (spreadsheets only)
file_info = client.files.create(file=..., purpose="assistants")
vs_file   = client.vector_stores.files.create(
    vector_store_id=..., file_id=file_info.id, chunking_strategy=...
)
client.vector_stores.files.poll(vs_file.id, vector_store_id=...)
```

Retry policy: up to 4 attempts for 404 / timeout / 429 / 5xx errors with linear back-off (3s, 6s, 9s, ...).

---

## Firestore document status lifecycle

```
pending → extracting → rag_ready
                    └→ failed
```

Status is written via `FirestoreMemoryService.update_document_status()` which is a transactional update (matches by `id` then `documentName`). Fields preserved across status transitions: `s3Bucket`, `s3Key`, `openaiFileId`, `vectorStoreId`, `attachableFileId`.

---

## WebSocket events emitted during ingestion

| Event type | When |
|---|---|
| `extractionProgress` | Start of extraction and start of indexing |
| `extractionCompleted` | JSON extraction complete (before indexing) |
| `ragIngestionCompleted` | All steps done — includes `s3Key`, `documentName`, human-readable `message` |
| `extractionFailed` | Any unhandled exception — includes `error` string |
