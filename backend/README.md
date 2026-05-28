# Polisense — Python Backend

FastAPI backend for the Polisense policy-research platform. Provides the REST API,
WebSocket chat channel, document ingestion pipeline, and geospatial tools consumed
by the Next.js frontend.

RAG can run on OpenAI's hosted stack (default) **or** on a fully local stack
(Weaviate + local embeddings/reranking + Docling, generation via OpenRouter),
selected per-capability by environment flags. See [Local RAG stack](#local-rag-stack).

---

## Table of Contents

1. [Architecture](#architecture)
2. [Directory Structure](#directory-structure)
3. [Requirements](#requirements)
4. [Setup](#setup)
5. [Running the Server](#running-the-server)
6. [Environment Variables](#environment-variables)
7. [API Reference](#api-reference)
8. [WebSocket Protocol](#websocket-protocol)
9. [Chat Flow](#chat-flow)
10. [Document Ingestion Pipeline](#document-ingestion-pipeline)
11. [Local RAG stack](#local-rag-stack)
12. [Geospatial (MCP) Service](#geospatial-mcp-service)
13. [Docker](#docker)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                         │
│                         (port 3000)                             │
│                                                                 │
│  pages/api/policy_research/  ──HTTP proxy──►  FastAPI :5029     │
│  WebSocket (research-api.js) ──WS──────────►  /ws               │
└─────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      FastAPI  (main.py)        │
                    │         port 5029              │
                    │                                │
                    │  /health  /ws  /api/policy_... │
                    └──┬──────────┬─────────────┬───┘
                       │          │             │
             ┌─────────▼──┐  ┌────▼────┐  ┌────▼──────────────┐
             │  Firestore  │  │ OpenAI  │  │   AWS S3           │
             │  (chatbot_  │  │  API    │  │  (document files)  │
             │  memories)  │  │         │  └────────────────────┘
             └─────────────┘  └────┬────┘
                                   │ file_search / input_file /
                                   │ code_interpreter / web_search
                                   ▼
                          OpenAI Vector Store
                          (per conversation)

                    ┌──────────────────────────────┐
                    │   Geo MCP Service             │
                    │   mcp-service/server.py       │
                    │   (spawned over stdio)        │
                    │                               │
                    │  tools:                       │
                    │    place_pins                 │
                    │    render_polygons            │
                    │    compute_centroid           │
                    │    create_buffer              │
                    │    run_deep_analysis          │
                    └──────────────────────────────┘
```

### Request flow (chat turn)

```
Frontend
  │
  ├─ PUT /api/policy_research/          HTTP — returns existing chatLog immediately
  │                                     fires bot.skills_first_conversation() as
  │                                     a background asyncio task
  │
  └─ WebSocket /ws
       ▲
       │  {sender, type, message}  frames streamed as the bot thinks
       │
       ├── intent router (gpt-4o-mini, JSON-mode)
       │       ↓ intent: rag | multi_query | conversational | geospatial
       │       ↓ trigger override: DRAW_POLYGON | OVERLAP | DEEP_ANALYSIS
       │
       ├── multimodal pipeline  (rag / multi_query / conversational)
       │       OpenAI Responses API
       │       tools: file_search, input_file/input_image, code_interpreter,
       │              web_search_preview
       │       real-time delta streaming → WS stream frames → WS end frame
       │
       └── geo handlers  (geospatial / DRAW_POLYGON / OVERLAP / DEEP_ANALYSIS)
               GeoMCPClient spawns mcp-service/server.py over stdio
               LLM selects tool → call_tool → WS map_concessions / analysis_panel
```

---

## Directory Structure

```
backend/
├── app/
│   ├── main.py                        Entry point — FastAPI app, all routes
│   ├── config/
│   │   └── firebase.py                Firebase Admin init, Firestore client
│   ├── services/
│   │   ├── firestore_memory_service.py  Read/write chatbot_memories collection
│   │   ├── openai_vector_store_service.py  Create/manage per-conv vector stores
│   │   └── s3_storage_service.py      Upload / download document files
│   ├── ingestion/
│   │   ├── openai_extraction_service.py  PDF / image / spreadsheet → text
│   │   └── json_converter.py          GeoJSON / JSON → Markdown for the vector store
│   ├── rag/                           Local AI stack (optional, flag-gated)
│   │   ├── config.py                  Weaviate + model env config
│   │   ├── embedder.py                sentence-transformers (MiniLM, CPU)
│   │   ├── reranker.py                BGE cross-encoder reranker
│   │   ├── chunking.py                Structure-aware chunk splitting
│   │   ├── ocr.py                     Docling layout-aware PDF parsing
│   │   ├── ingest_document.py         Dual-write: PDF/markdown → chunks → Weaviate
│   │   ├── shadow.py                  Observe-only shadow retrieval (logs JSONL)
│   │   ├── providers/                 LLMProvider abstraction
│   │   │   ├── base.py                OpenAI-compatible base (classify_json, stream_chat)
│   │   │   ├── openai_provider.py     OpenAI (default)
│   │   │   ├── openrouter_provider.py OpenRouter (local generation/router)
│   │   │   └── factory.py             get_provider / get_generation_provider
│   │   └── store/                     Weaviate
│   │       ├── config.py              Client factory
│   │       ├── schema.py              Chunk schema (incl. memoryId/documentId)
│   │       ├── ingest.py              ingest_chunks / delete_by_memory
│   │       ├── retrieve.py            bm25 / vector / hybrid + memoryId filter
│   │       └── verify.py              Inspect collection contents
│   └── chatbot/
│       ├── base_chat_bot.py           Async port of PsBaseChatBot (WS helpers,
│       │                              Firestore memory, cost accounting)
│       ├── router.py                  Intent router (gpt-4o-mini JSON-mode)
│       ├── document_context_service.py  Resolves file attachments for a conv
│       ├── skills_first_chat_bot.py   Main bot: multimodal pipeline + geo handlers
│       ├── geo_mcp_client.py          MCP stdio client (spawns mcp-service)
│       └── geo_utils.py               UTM math, vertex parsing, centroid helpers
│
├── mcp-service/                       Geospatial MCP server (Python FastMCP)
│   ├── server.py                      Tool definitions exposed via MCP
│   ├── requirements.txt               shapely, mcp[cli], requests, python-dotenv
│   ├── tools/
│   │   ├── geocatmin_spatial.py       Catastro Minero spatial queries
│   │   ├── geocode.py                 Geocoding helpers
│   │   └── polygon_from_document.py   UTM polygon extraction
│   └── data/
│       └── Catastro.geojson           Mining concessions reference dataset
│
├── data/
│   └── dataLayout.json                RAG router category config
│
├── Dockerfile                         Python 3.11-slim image (repo-root context)
├── requirements.txt                   Main app Python deps
├── start.sh                           Dev server (--reload)
├── start-prod.sh                      Production server
├── ws_watch.py                        WS debug helper
├── .env.example                       Environment variable template
├── .env                               Local secrets (git-ignored)
├── .env.production                    Production secrets (git-ignored)
└── serviceAccountKey.json             Firebase service account (git-ignored)
```

---

## Requirements

| Requirement | Version |
|---|---|
| Python | 3.10 or 3.11 |
| pip | any recent |
| Firebase project | `sturdy-quarter-479808-p0` |
| OpenAI account | API key with Files + Responses API access |
| AWS S3 bucket | for document storage |
| Weaviate | only for the local RAG stack — `docker compose up -d weaviate` |
| OpenRouter account | only for local generation/router (`*_local`) |

> `requirements.txt` includes the local-stack deps (`weaviate-client`,
> `sentence-transformers`, `torch`, `docling`, `PyMuPDF`). These are heavy
> (~GB image size) and download embedding/reranker/Docling weights on first use.
> They are imported lazily — if you never enable the RAG flags, they are not
> loaded at runtime.

---

## Setup

### 1. Create the main app virtualenv

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 2. Create the MCP geo service virtualenv

The geo service has its own isolated venv because it runs as a subprocess:

```bash
cd backend/mcp-service
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

> Without this venv the geo/map features are disabled. The rest of the API
> (conversations, ingestion, chat) works fine without it.

### 3. Configure credentials

Copy the example and fill in your values:

```bash
cp .env.example .env
# edit .env with your keys
```

Place your Firebase service account key at `backend/serviceAccountKey.json`.
Alternatively set `GOOGLE_APPLICATION_CREDENTIALS` to its path, or set
`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` as environment variables.

---

## Running the Server

### Development (auto-reload on file changes)

```bash
cd backend
./start.sh
```

The server starts at **http://localhost:5029**.

### Production

```bash
cd backend
./start-prod.sh
```

Reads `.env.production` if present, falls back to `.env`.

### Manual uvicorn invocation

```bash
cd backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 5029 --reload
```

> **Single worker only.** The WebSocket client registry (`ws_clients`) is in-memory.
> Running multiple workers would split connections across processes and break chat streaming.

---

## Environment Variables

All variables are optional unless marked required.

### Firebase

| Variable | Description |
|---|---|
| `FIREBASE_PROJECT_ID` | Firestore project (default: `sturdy-quarter-479808-p0`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON file |
| `FIREBASE_CLIENT_EMAIL` | Service account email (alternative to key file) |
| `FIREBASE_PRIVATE_KEY` | Service account private key (alternative to key file) |

### OpenAI

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required.** Your OpenAI API key |
| `AI_MODEL_NAME` | `gpt-4o-mini` | Model used for routing and geo tool selection |
| `EXTRACTION_MODEL` | `gpt-4o` | Model used for vision OCR and PDF extraction |

### AWS S3

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | **Required** for document upload/download |
| `AWS_SECRET_ACCESS_KEY` | **Required** for document upload/download |
| `AWS_REGION` | S3 region (default: `us-east-1`) |
| `AWS_S3_BUCKET` | Bucket name for document storage |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5029` | Port the uvicorn server binds to |
| `API_BASE_PATH` | `/api/policy_research` | Prefix for all API routes |

### Optional overrides

| Variable | Default | Description |
|---|---|---|
| `DATA_LAYOUT_PATH` | `data/dataLayout.json` | Path to RAG router category config |
| `MCP_SERVICE_DIR` | `mcp-service/` | Path to geo MCP service directory |
| `PYTHON_EXECUTABLE` | `python3` | Python interpreter fallback for MCP service |
| `MULTIMODAL_MAX_ATTACHED_FILES` | `4` | Max files attached per chat message |
| `MULTIMODAL_MAX_ATTACHED_BYTES` | `12582912` (12 MB) | Max total bytes attached per message |

---

## API Reference

All routes are prefixed with `API_BASE_PATH` (default `/api/policy_research`).

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe. Returns `{status, timestamp}`. |

### Conversations

| Method | Path | Description |
|---|---|---|
| `GET` | `/conversations` | List all conversations for a `userId` query param |
| `GET` | `/{memory_id}` | Get chat log and total cost for a conversation |
| `DELETE` | `/conversations/{memory_id}` | Delete conversation + all artifacts (S3, vector store, OpenAI files) |
| `POST` | `/conversations/{memory_id}/metadata` | Update conversation title / metadata |

### Documents

| Method | Path | Description |
|---|---|---|
| `GET` | `/conversations/{memory_id}/documents` | List documents attached to a conversation |
| `POST` | `/conversations/{memory_id}/documents` | Add a document record (metadata only) |
| `PUT` | `/conversations/{memory_id}/documents/{document_id}` | Update document metadata |
| `DELETE` | `/conversations/{memory_id}/documents/{document_id}` | Remove document + artifacts |
| `GET` | `/conversations/{memory_id}/documents/{document_id}/download` | Download file (S3 then OpenAI fallback) |

### Ingestion

All ingestion routes return `202 Accepted` immediately and process in the background.
Progress is broadcast over the WebSocket as `{sender, type, data}` events.

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/ingest-pdf` | `multipart/form-data` | PDF, image, Excel, or legacy XLS. Extracts text (vision OCR fallback for scanned PDFs), uploads to vector store. |
| `POST` | `/ingest-json` | `{memoryId, fileId, fileName, data}` | JSON or GeoJSON — converts to Markdown, uploads to vector store. |
| `POST` | `/ingest-geojson` | `{memoryId, fileId, fileName, data, summary}` | GeoJSON with pre-computed summary — uploads converted Markdown. |

### Chat

| Method | Path | Body | Description |
|---|---|---|---|
| `PUT` | `/` | `{chatLog, wsClientId, memoryId, userId, silentMode?}` | Starts a chat turn. Returns the existing `chatLog` synchronously; streams the bot reply over WebSocket. |

---

## WebSocket Protocol

**Endpoint:** `ws://localhost:5029/ws`

### Handshake

The client must send a JSON frame immediately after connecting:

```json
{ "clientId": "<uuid>" }
```

The server registers the connection and responds with:

```json
{ "sender": "system", "type": "hello", "message": "Welcome!" }
```

### Chat message frames

All frames during a chat turn use this envelope:

```json
{ "sender": "bot", "type": "<type>", "message": "<text>" }
```

| `type` | When sent |
|---|---|
| `stream` | Each streamed text delta from the model |
| `end` | Bot turn complete |
| `thinking` | Intermediate status (e.g. "Searching documents…") |
| `agentStart` | A tool call has started |
| `agentCompleted` | A tool call has finished |
| `agentUpdated` | Tool progress update |

### Geo / map frames

Map and panel events use a different envelope:

```json
{ "sender": "bot", "type": "<type>", "data": { ... } }
```

| `type` | `data` shape | Description |
|---|---|---|
| `map_concessions` | `{type:"FeatureCollection", features:[...]}` | GeoJSON to render on the Mapbox map |
| `analysis_panel` | `{html: "..."}` | HTML content for the deep-analysis side panel |

### Ingestion broadcast frames

```json
{ "sender": "agent", "type": "<type>", "data": { ... } }
```

| `type` | Description |
|---|---|
| `update` | Processing progress (e.g. "Uploading to vector store…") |
| `done` | Ingestion complete |
| `error` | Ingestion failed |

---

## Chat Flow

```
PUT /  →  SkillsFirstChatBot.skills_first_conversation(chatLog, dataLayout)
             │
             ├─ Regex pre-check
             │   DEEP_ANALYSIS pattern  →  handle_geospatial_query()
             │   DRAW_POLYGON pattern   →  handle_draw_polygon_from_document()
             │   OVERLAP pattern        →  handle_overlap_analysis()
             │
             ├─ PsRagRouter.get_routing_data()   (gpt-4o-mini, JSON-mode)
             │   returns: { intent, primaryCategory,
             │              rewrittenUserQuestionVectorDatabaseSearch }
             │
             ├─ intent == "geospatial"  →  handle_geospatial_query()
             │
             └─ intent == "rag" | "multi_query" | "conversational"
                    │
                    └─ run_multimodal_conversation()
                           DocumentContextService.build_for_conversation()
                             → vectorStoreId, attachableFileIds, imageFileIds
                           OpenAI Responses API
                             tools: file_search (if vector store exists)
                                    input_file / input_image (per attached file)
                                    code_interpreter
                                    web_search_preview
                           Stream response.output_text.delta  →  WS "stream"
                           Append citation footer
                           Save turn to Firestore chatLog
                           WS "end"
```

### Intent values

| Intent | Meaning |
|---|---|
| `rag` | Question answered from uploaded documents via file_search |
| `multi_query` | Multi-step document question |
| `conversational` | General chat, no document lookup needed |
| `geospatial` | Triggers GeoMCPClient for map / polygon tools |

---

## Document Ingestion Pipeline

```
POST /ingest-pdf  (multipart)
  │
  ├─ MIME detection
  │     application/pdf  ─────────────┐
  │     image/*          ────────┐    │
  │     spreadsheet      ──┐     │    │
  │                        │     │    │
  │   Excel / XLS ─────────┘     │    │
  │     openpyxl extract         │    │
  │     → Markdown tables        │    │
  │                              │    │
  │   Image ─────────────────────┘    │
  │     GPT-4o vision OCR             │
  │     → Markdown text               │
  │     upload_for_attachment()       │
  │     → attachableFileId            │
  │                                   │
  │   PDF ────────────────────────────┘
  │     pypdf text extraction
  │     if avg < 80 chars/page:
  │       vision fallback (GPT-4o)
  │     upload_for_attachment()
  │     → attachableFileId
  │
  ├─ Upload Markdown to OpenAI Files  (purpose=assistants)
  ├─ Add file to conversation vector store
  │     (get_or_create_vector_store — compare-and-set in Firestore)
  ├─ Upload original bytes to S3  → s3Key
  └─ Save document record to Firestore  (extractionStatus = "rag_ready")
```

---

## Geospatial (MCP) Service

The geo service is a separate Python process started on-demand via stdio using the
[MCP protocol](https://modelcontextprotocol.io).

### How it works

1. `GeoMCPClient.connect()` spawns `mcp-service/server.py` as a subprocess.
2. `list_tools_for_openai()` fetches the tool schemas and converts them to OpenAI
   function-calling format.
3. GPT-4o selects a tool and provides arguments.
4. `call_tool(name, args)` sends the JSON-RPC call over stdio, returns the first
   text block parsed as JSON.
5. `disconnect()` tears down the subprocess.

### Python interpreter resolution

The client looks for an interpreter in this order:

1. `mcp-service/venv/bin/python` — dedicated venv (recommended)
2. `$PYTHON_EXECUTABLE` environment variable
3. `python3` system default

### Available tools

| Tool | Description |
|---|---|
| `place_pins` | Geocode locations and return GeoJSON points |
| `render_polygons` | Build polygon GeoJSON from UTM coordinates |
| `compute_centroid` | Return the centroid of a polygon set |
| `create_buffer` | Buffer a point by a given radius |
| `run_deep_analysis` | Spatial analysis against Catastro.geojson with HTML output |

### Setup (required for geo features)

```bash
cd backend/mcp-service
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

---

## Docker

Build context must be the **repo root** (not `backend/`):

```bash
# from repo root
docker build -f backend/Dockerfile -t polisense-api .
```

Run:

```bash
docker run -p 5029:5029 polisense-api
```

### What the Dockerfile does

1. `python:3.11-slim` base with `libgeos-dev` (required by shapely).
2. Builds `mcp-service/venv` as an independent cached layer.
3. Builds `.venv` for the main app as a second cached layer.
4. Copies app source, data, and MCP service files.
5. Copies `serviceAccountKey.json` and `.env.production` into the image.
6. Exposes port 5029 and starts via `start-prod.sh`.

> **Note:** `serviceAccountKey.json` and `.env.production` are baked into the image.
> For production deployments, prefer mounting them as secrets or using environment
> variables (`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`) instead.

### docker-compose (with frontend)

Add a `docker-compose.yml` at the repo root if you want to run both services together:

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "5029:5029"
    env_file: backend/.env.production

  frontend:
    build:
      context: frontend
    ports:
      - "3000:3000"
    environment:
      - RESEARCH_API_URL=http://backend:5029
      - NEXT_PUBLIC_RESEARCH_WS_URL=ws://backend:5029/ws
    depends_on:
      - backend
```
