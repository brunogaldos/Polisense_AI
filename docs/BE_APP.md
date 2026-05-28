# BE_APP — FastAPI Application (`app/main.py`)

The entry point for the entire Python backend. Owns the ASGI app, CORS middleware, WebSocket registry, all HTTP routes, and the fire-and-forget ingestion tasks.

---

## Startup sequence

```
uvicorn app.main:app
        │
        ├─ logging.basicConfig(WARNING) — library noise suppressed
        ├─ logging.getLogger("polisense").setLevel(INFO) — our logs visible
        ├─ _load_data_layout() — reads backend/data/dataLayout.json (or DATA_LAYOUT_PATH)
        ├─ FastAPI() created
        ├─ CORSMiddleware added (allow_origin_regex=".*", allow_credentials=True)
        └─ ws_clients: dict[str, WebSocket] = {} mounted on app.state
```

`DATA_LAYOUT` is a module-level global loaded once at import time. It feeds `PsRagRouter` with category names and the `aboutProject` string.

---

## Route map

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — returns `{status, timestamp}` instantly |
| `WS` | `/ws` | WebSocket endpoint — assigns `clientId`, registers socket |
| `PUT` | `{BASE}/` | Chat turn — loads memory, detaches bot task, returns chatLog |
| `GET` | `{BASE}/{memory_id}` | Fetch chat log + costs for a conversation |
| `GET` | `{BASE}/conversations` | List conversations for a userId |
| `GET` | `{BASE}/conversations/{id}/documents` | List uploaded documents |
| `POST` | `{BASE}/conversations/{id}/documents` | Register a document |
| `PUT` | `{BASE}/conversations/{id}/documents/{doc_id}` | Update document status |
| `DELETE` | `{BASE}/conversations/{id}/documents/{doc_id}` | Remove document + cleanup |
| `DELETE` | `{BASE}/conversations/{id}` | Delete conversation + vector store |
| `POST` | `{BASE}/conversations/{id}/metadata` | Update title/summary |
| `POST` | `{BASE}/ingest-pdf` | Multipart PDF/image/spreadsheet upload |
| `POST` | `{BASE}/ingest-geojson` | GeoJSON FeatureCollection ingestion |
| `POST` | `{BASE}/ingest-json` | Arbitrary JSON ingestion |
| `GET` | `{BASE}/conversations/{id}/documents/{doc_id}/download` | Download original file |

`BASE` = `API_BASE_PATH` env var (default `/api/policy_research`).

---

## WebSocket registry

```python
ws_clients: dict[str, WebSocket] = {}
app.state.ws_clients = ws_clients
```

On connect, a UUID `clientId` is assigned and sent as the first frame. The frontend resolves its connect promise on this frame and passes `wsClientId` in every subsequent HTTP chat request.

```
Browser ──WS connect──► /ws
         ◄── {"clientId": "abc-123"} ── first frame

Browser ──PUT /──► body: { wsClientId: "abc-123", chatLog: [...] }
         ◄── HTTP 200 (chatLog snapshot)
         ◄── WS stream: { type: "start" } ... { type: "stream", message: "..." } ... { type: "end" }
```

The registry is **in-memory** (a plain dict). This is why `--workers 1` is enforced in production — multiple workers would have separate registries and a chat turn could be routed to a worker that doesn't hold the client's socket.

---

## Chat turn (`PUT /`)

```python
@app.put(BASE_PATH + "/")
async def skills_first_chat(body: dict):
    # 1. Parse body: chatLog, wsClientId, memoryId, silentMode, userId
    # 2. Log CHAT REQUEST with user, memory, log length, last message
    # 3. Construct SkillsFirstChatBot
    # 4. If memoryId: pre-load memory from Firestore so HTTP can return chatLog immediately
    # 5. asyncio.create_task(bot.skills_first_conversation(chat_log, DATA_LAYOUT))
    # 6. Return saved chatLog (HTTP) — bot streams answer over WS
```

The key design: HTTP response returns the **existing** chat log from Firestore immediately (for UI hydration), while the bot runs asynchronously and streams tokens over WebSocket. This mirrors the original Node pattern.

---

## Ingestion — fire-and-forget tasks

All three ingestion endpoints follow the same pattern:

```
HTTP handler
  1. Validate body / file
  2. Generate fileId = "{timestamp}_{rand}_{sanitized_name}"
  3. asyncio.create_task(_process_*_ingestion(...))   ← detached
  4. Return 202 Accepted with fileId immediately

Background task (_process_*_ingestion)
  1. WS: extractionProgress { phase: "extracting" }
  2. S3: upload original bytes (non-fatal)
  3. OpenAI: index in vector store
  4. Firestore: update document status
  5. WS: ragIngestionCompleted  OR  extractionFailed
```

### PDF ingestion routing

```
ingest-pdf (multipart)
    │
    ├─ image/* or .png/.jpg → upload original + OCR for file_search
    ├─ .xlsx/.xlsm/.xltm/.xltx → openpyxl local extraction → Markdown → VS
    ├─ .xls/.xlsb → ValueError (not supported)
    └─ default (PDF) ─► direct vector-store upload
                            └─ if "could not be parsed" error:
                                └─ GPT-4o vision OCR fallback
```

### GeoJSON ingestion

For each feature: extracts geometry type, centroid, and property key-values into:
- `short_lines` → stored in Firestore `geojson_summaries` subcollection (capped at 200 features, ~30KB) — used by the geo handler at chat time
- `rich_blocks` → full text indexed in vector store for semantic search

### JSON ingestion

Converts arbitrary JSON (array or object) to Markdown via `json_to_markdown()`, then indexes in vector store. Also stores a summary list via `json_to_summary_lines()` in Firestore.

---

## Download endpoint

Search order for the requested document:
1. Exact `id` match in Firestore documents
2. `name == documentId` (handles id/name drift)
3. `name == ?name=` query param hint

Retrieval order:
1. S3 (`s3Bucket` + `s3Key`) — primary
2. OpenAI Files API (`openaiFileId`) — fallback for docs uploaded before S3 support

---

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `API_BASE_PATH` | `/api/policy_research` | Prefix for all routes |
| `DATA_LAYOUT_PATH` | — | Override path for `dataLayout.json` |
| `PORT` | `5029` | Set by `start-prod.sh` before uvicorn |
