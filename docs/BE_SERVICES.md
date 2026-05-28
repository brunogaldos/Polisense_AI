# BE_SERVICES — Services Layer

Three stateless service classes handle all external persistence. All blocking SDK calls are designed to be run via `asyncio.to_thread()` from async route handlers — they never touch the event loop directly.

---

## Service overview

| Service | File | External system | Purpose |
|---|---|---|---|
| `FirestoreMemoryService` | `services/firestore_memory_service.py` | Firebase Firestore | Conversation memory, chat logs, document metadata |
| `OpenAIVectorStoreService` | `services/openai_vector_store_service.py` | OpenAI Files + Vector Stores API | Semantic search index for uploaded documents |
| `S3StorageService` | `services/s3_storage_service.py` | AWS S3 | Original file backup and download recovery |

---

## Firebase configuration (`config/firebase.py`)

Credential resolution chain (first match wins):

```
1. GOOGLE_APPLICATION_CREDENTIALS env var (path to JSON)
2. Path.cwd() / "serviceAccountKey.json"
3. backend/ / "serviceAccountKey.json"
4. backend/../"serviceAccountKey.json"  (repo root)
```

`.env` is auto-loaded from `backend/.env` if present (via `python-dotenv`).

The Firebase Admin SDK is initialized once at import time; `db` is the Firestore client.

---

## `FirestoreMemoryService`

### Firestore collection

All conversations live in a single collection: **`chatbot_memories`**  
Each document ID is the `memoryId` (UUID generated at conversation start).

### Document shape

```json
{
  "memoryId": "conv_1748463600000_abc123",
  "userId": "firebase_auth_uid",
  "chatLog": [
    {"sender": "user",      "message": "What is ..."},
    {"sender": "assistant", "message": "The answer is ..."}
  ],
  "vectorStoreId": "vs_openai_id",
  "uploadedDocuments": [
    {
      "id":               "1748463600000_xyz_report.pdf",
      "name":             "report.pdf",
      "size":             1024000,
      "type":             "application/pdf",
      "extractionStatus": "rag_ready",
      "openaiFileId":     "file-abc",
      "attachableFileId": "file-abc",
      "vectorStoreId":    "vs_openai_id",
      "s3Bucket":         "amazn-s3-polisense-bucket",
      "s3Key":            "uploads/1748463600000/report.pdf",
      "uploadTime":       "<Firestore Timestamp>"
    }
  ],
  "stages": {
    "chatbot-conversation": {
      "tokensIn": 1250, "tokensInCost": 0.0125,
      "tokensOut": 430, "tokensOutCost": 0.0129
    }
  },
  "conversationTitle": "report - What",
  "lastUserMessage": "What is the thesis about",
  "messageCount": 4,
  "createdAt": "<Firestore Timestamp>",
  "updatedAt": "<Firestore Timestamp>"
}
```

A `geojson_summaries` **subcollection** hangs off each document:
```
chatbot_memories/{memoryId}/geojson_summaries/{fileId}
  → { fileId, fileName, summaries: ["Feature 1 | ...", ...] }
```

### Key methods

| Method | Description |
|---|---|
| `load_memory(memory_id)` | Fetch and normalize a conversation doc |
| `save_memory(memory_id, memory, user_id)` | Merge-write chatLog + stages + title (set merge=True) |
| `get_user_conversations(user_id, limit=20)` | List by userId ordered by updatedAt DESC |
| `get_conversation_documents(memory_id)` | Return `uploadedDocuments` array |
| `get_vector_store_id(memory_id)` | Fast single-field read |
| `get_geojson_summaries(memory_id)` | Read from subcollection, flatten to list of strings |
| `add_or_update_document(memory_id, doc)` | Transactional upsert (match by id then name) |
| `update_document_status(memory_id, doc_id, status, extras)` | Transactional field update |
| `remove_document(memory_id, doc_id)` | Transactional removal, returns deleted record |
| `save_geojson_summaries(memory_id, file_id, name, summaries)` | Write geo context to subcollection |
| `delete_memory(memory_id)` | Hard delete conversation doc |
| `update_conversation_metadata(memory_id, metadata)` | Update title/summary |

### Sender normalization

The Node backend stored assistant turns as `sender: "bot"`. This is normalized on read:

```python
def _normalize_sender(msg):
    if msg.get("sender") == "bot":
        return "assistant"
    # messageType fallbacks for legacy formats
```

### Concurrency safety

`add_or_update_document` and `update_document_status` use `@firestore.transactional` to prevent concurrent uploads (multi-file drag-drop) from clobbering each other.

During a document upsert, terminal statuses (`rag_ready`, `completed`) and existing storage refs (`s3Key`, `openaiFileId`, `vectorStoreId`, `attachableFileId`) are preserved — a status regression (e.g. setting `pending` over `rag_ready`) is silently blocked.

---

## `OpenAIVectorStoreService`

### One vector store per conversation

Each conversation has exactly one OpenAI vector store. The ID is persisted as `vectorStoreId` in the Firestore document.

```
Conversation → vectorStoreId → all uploaded docs indexed in same store
                             → file_search searches across all of them
```

### `get_or_create_vector_store(memory_id)`

Race-safe creation for concurrent multi-file uploads:

```
Process-local lock (per memory_id)
    │
    ├─ Fast path: vectorStoreId already in Firestore → return it
    │
    └─ Create new vector store in OpenAI API
            │
            └─ Firestore compare-and-set transaction:
                    ├─ Won race → write vectorStoreId to Firestore
                    └─ Lost race → delete our orphan, return winner's id
```

The process-local `threading.Lock` prevents duplicate creation within one process. The Firestore transaction is the cross-process backstop (relevant for horizontal scaling, though `--workers 1` is the default).

Vector stores are configured with `expires_after={"anchor": "last_active_at", "days": 30}` — auto-deleted 30 days after last use.

### `upload_file_to_vector_store(...)`

```python
# Default: SDK upload_and_poll (OpenAI auto chunking)
vs_file = client.vector_stores.files.upload_and_poll(
    vector_store_id=vector_store_id,
    file=(file_name, buffer, mime_type)
)

# With chunking_strategy (spreadsheets): manual 3-step
file_info = client.files.create(file=..., purpose="assistants")
vs_file   = client.vector_stores.files.create(
    vector_store_id=..., file_id=file_info.id, chunking_strategy=chunking_strategy
)
client.vector_stores.files.poll(vs_file.id, ...)
```

Retry policy: 4 attempts, linear back-off (3s increments), retries on 404 / timeout / 429 / 5xx.

### Cleanup

```python
delete_file_artifacts(vector_store_id, vector_store_file_id, attachable_file_id)
# Independently try/excepts each step — partial failure never blocks the caller

delete_vector_store(vector_store_id)
# Deletes the whole store when a conversation is deleted
```

When a document is removed: detach from vector store → delete the vector-store file → delete the attachable file (if different ID).

When a conversation is deleted: clean all documents then delete the vector store.

---

## `S3StorageService`

Thin wrapper around `boto3`. All methods are synchronous — call with `asyncio.to_thread`.

```python
# Upload
result = S3StorageService.upload_file(
    buffer       = bytes(...),
    key          = "uploads/1748463600000/report.pdf",
    content_type = "application/pdf"
)
# Returns: {"bucket": "...", "key": "...", "versionId": None}

# Download
file_bytes = S3StorageService.download_file(bucket, key)
```

S3 key pattern: `uploads/<epoch_ms>/<sanitized_filename>`

The bucket/key pair is stored in Firestore alongside the document record. The download endpoint reads these refs and streams the bytes directly to the browser.

S3 upload failures are **non-fatal** — logged as errors and the ingestion pipeline continues without an S3 ref. Such documents can still be queried via the vector store but cannot be downloaded.

### Required env vars

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION         # e.g. eu-north-1
AWS_S3_BUCKET      # e.g. amazn-s3-polisense-bucket
```

The IAM user needs `PutObject` and `GetObject` permissions on the configured bucket.

---

## Call pattern (async handlers)

All three services are used with `asyncio.to_thread` to keep the event loop free:

```python
# Reading
memory = await asyncio.to_thread(FirestoreMemoryService.load_memory, memory_id)

# Writing (fire-and-forget inside a background task)
await asyncio.to_thread(
    FirestoreMemoryService.add_or_update_document, memory_id, doc
)

# Vector store (blocking SDK call)
vs_id = await asyncio.to_thread(
    OpenAIVectorStoreService.get_or_create_vector_store, memory_id
)

# S3
s3_result = await asyncio.to_thread(
    S3StorageService.upload_file, buffer, key, content_type
)
```
