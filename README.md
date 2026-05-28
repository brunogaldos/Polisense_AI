# Polisense AI

AI copilot for government resource planning. RAG-powered platform for processing, analyzing, and querying policy documents with an integrated geospatial service for interactive mining concessions mapping (Catastro Minero / GEOCATMIN).

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 13, React, Mapbox GL |
| Backend | Python 3.11, FastAPI, uvicorn |
| AI (cloud, default) | OpenAI Responses API (gpt-4o), file_search, code_interpreter, web_search |
| AI (local, optional) | Weaviate + sentence-transformers (MiniLM) + BGE reranker + Docling; generation via OpenRouter |
| Memory | Firebase Firestore |
| File storage | AWS S3 |
| Geo service | Python FastMCP (stdio subprocess) |

The backend can run RAG **entirely on a local stack** (Weaviate vector DB +
local embeddings/reranking + Docling parsing) instead of OpenAI's hosted
`file_search`, selected per-capability by environment flags. Everything defaults
to the OpenAI behaviour above; see [Local AI stack](#local-ai-stack-optional)
and `backend/README.md` for details.

## Architecture

```
Browser
  │
  ├─ HTTP  → frontend:3000/api/policy_research/*  (Next.js proxy)
  │                    │
  │                    └─ RESEARCH_API_URL ──────► backend:5029
  │
  └─ WS    → localhost:5029/ws ──────────────────► backend:5029
                                                        │
                                          ┌─────────────┴────────────┐
                                          │  FastAPI app             │
                                          │  ┌──────────────────┐    │
                                          │  │ SkillsFirstBot   │    │
                                          │  │  router → intent │    │
                                          │  │  rag / geo / ... │    │
                                          │  └────────┬─────────┘    │
                                          │           │ geospatial   │
                                          │  ┌────────▼─────────┐    │
                                          │  │ GeoMCPClient     │    │
                                          │  │ (stdio process)  │    │
                                          │  └────────┬─────────┘    │
                                          │           │              │
                                          │  mcp-service/server.py   │
                                          │  Catastro.geojson        │
                                          └──────────────────────────┘
```

**Chat turn flow:**
1. Frontend PUT `/api/policy_research/` → Next.js proxy → backend
2. Backend loads memory from Firestore, detaches a task, returns immediately
3. Task: router classifies intent → `rag`, `geospatial`, `multi_query`, or `conversational`
4. RAG path: OpenAI Responses API streams back over WebSocket
5. Geo path: MCP stdio subprocess queries Catastro.geojson → GeoJSON pushed to map over WebSocket

## Repository structure

```
Polisense/
├── backend/
│   ├── app/
│   │   ├── main.py                      # FastAPI app, all routes
│   │   ├── chatbot/
│   │   │   ├── skills_first_chat_bot.py # Main chat turn + geo handlers
│   │   │   ├── base_chat_bot.py         # WS helpers, memory, cost tracking
│   │   │   ├── router.py                # Intent classifier (gpt-4o-mini)
│   │   │   ├── document_context_service.py
│   │   │   ├── geo_mcp_client.py        # MCP stdio client
│   │   │   └── geo_utils.py             # UTM math, vertex extraction
│   │   ├── ingestion/
│   │   │   ├── openai_extraction_service.py
│   │   │   └── json_converter.py
│   │   ├── rag/                         # Local AI stack (optional, flag-gated)
│   │   │   ├── embedder.py              # sentence-transformers (MiniLM, CPU)
│   │   │   ├── reranker.py              # BGE cross-encoder
│   │   │   ├── chunking.py              # structure-aware chunking
│   │   │   ├── ocr.py                   # Docling PDF parsing
│   │   │   ├── ingest_document.py       # dual-write helper (PDF/markdown → Weaviate)
│   │   │   ├── shadow.py                # observe-only shadow retrieval
│   │   │   ├── providers/               # LLMProvider: OpenAI + OpenRouter + factory
│   │   │   └── store/                   # Weaviate ingest / retrieve / schema / verify
│   │   ├── services/
│   │   │   ├── firestore_memory_service.py
│   │   │   ├── openai_vector_store_service.py
│   │   │   └── s3_storage_service.py
│   │   └── config/
│   │       └── firebase.py
│   ├── mcp-service/
│   │   ├── server.py                    # FastMCP geospatial tools
│   │   ├── tools/                       # geocode, spatial query, polygon
│   │   ├── data/Catastro.geojson        # GEOCATMIN mining concessions (Peru)
│   │   └── requirements.txt
│   ├── data/
│   │   └── dataLayout.json              # RAG category schema
│   ├── requirements.txt
│   ├── .env                             # Local dev secrets (git-ignored)
│   ├── .env.example                     # Template
│   ├── .env.production                  # Production secrets (git-ignored)
│   ├── serviceAccountKey.json           # Firebase service account (git-ignored)
│   ├── Dockerfile                       # Local docker-compose build
│   └── Dockerfile_prod                  # GCP Cloud Run build
│
├── frontend/
│   ├── components/research/             # AI chatbot UI
│   ├── pages/api/policy_research/       # Next.js proxy routes → backend
│   ├── services/research-api.js         # WS + HTTP client
│   ├── Dockerfile                       # Local docker-compose build
│   └── Dockerfile_prod                  # GCP Cloud Run build
│
└── docker-compose.yml                   # Local full-stack container run
```

---

## 1 — Local development (no Docker)

### Prerequisites

- Python 3.11+
- Node.js 22 via nvm (`nvm use 22.20.0`)
- Firebase service account key placed at `backend/serviceAccountKey.json`

### Backend

```bash
cd backend

# First time: create venv and install deps
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# MCP geo service (first time)
python3 -m venv mcp-service/venv
mcp-service/venv/bin/pip install -r mcp-service/requirements.txt

# Copy and fill in env vars
cp .env.example .env
# edit .env — at minimum set OPENAI_API_KEY, AWS_*, Firebase vars

# Run dev server (auto-reload)
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 5029 --reload
```

Backend is live at `http://localhost:5029`. Health check: `curl http://localhost:5029/health`.

### Frontend

```bash
cd frontend
nvm use 22.20.0
yarn install
yarn dev        # http://localhost:3000
```

The frontend proxy reads `RESEARCH_API_URL` (server-side) which defaults to `http://localhost:5029`, so no extra config is needed for local dev.

---

## 2 — Local Docker (docker-compose)

Runs both services as containers on the same bridge network.

```bash
# From repo root
docker-compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:5029 |
| Weaviate | http://localhost:8090 (local AI stack; only used when the RAG flags are on) |

> The `weaviate` service starts with the stack but is inert until you enable the
> local RAG flags (see [Local AI stack](#local-ai-stack-optional)). The backend
> reaches it at `weaviate:8080` on the compose network.

**How URLs are wired:**

| Variable | Value | Purpose |
|---|---|---|
| `RESEARCH_API_URL` | `http://backend:5029` | Next.js proxy → backend (Docker DNS) |
| `NEXT_PUBLIC_RESEARCH_WS_URL` | `ws://localhost:5029/ws` | Browser WebSocket → exposed port |

To rebuild after code changes:
```bash
docker-compose up --build --force-recreate
```

---

## 3 — Production (Google Cloud Platform / Cloud Run)

Each service is built separately with its `Dockerfile_prod` and deployed as an independent Cloud Run service.

### Backend

```bash
# Build from repo root (context must be .)
docker build \
  -f backend/Dockerfile_prod \
  -t gcr.io/<PROJECT>/polisense-backend:latest \
  .

docker push gcr.io/<PROJECT>/polisense-backend:latest
```

Deploy to Cloud Run with env vars from `backend/.env.production` (already baked into the image via the Dockerfile COPY).

### Frontend

```bash
# Build from frontend/ directory
docker build \
  -f frontend/Dockerfile_prod \
  --build-arg NEXT_PUBLIC_RESEARCH_WS_URL=wss://<BACKEND_CLOUD_RUN_URL>/ws \
  --build-arg NEXT_PUBLIC_RESEARCH_API_URL=https://<BACKEND_CLOUD_RUN_URL> \
  -t gcr.io/<PROJECT>/polisense-frontend:latest \
  frontend/

docker push gcr.io/<PROJECT>/polisense-frontend:latest
```

> `NEXT_PUBLIC_*` vars are baked into the JS bundle at build time — they must be passed as `--build-arg` at image build, not at `docker run`.

The server-side `RESEARCH_API_URL` (used by the Next.js proxy) should be set as a Cloud Run environment variable pointing to the backend service URL.

---

## Local AI stack (optional)

The backend can serve RAG from a **local stack** instead of OpenAI's hosted
tools, to reduce OpenAI dependency. It is a drop-in behind environment flags —
**every flag defaults to the original OpenAI behaviour**, so an unconfigured
deploy is unchanged.

What it replaces:

| Capability | Cloud (default) | Local |
|---|---|---|
| Embeddings + vector store | OpenAI vector store | Weaviate + sentence-transformers (MiniLM, CPU) |
| Retrieval | OpenAI hosted `file_search` | Weaviate hybrid (BM25 + vector) + BGE reranker |
| PDF parsing | OpenAI vision OCR | Docling (layout-aware) |
| Generation | OpenAI Responses API (gpt-4o) | OpenRouter (OpenAI-compatible) |
| Router (intent) | OpenAI gpt-4o-mini | OpenAI **or** OpenRouter |

### Flags (all default to OpenAI)

| Variable | Values | Effect |
|---|---|---|
| `AI_PROVIDER` | `openai` (default) / `local` | Which provider classifies intent (router) |
| `RAG_DUAL_WRITE` | off (default) / `1` | Also chunk+embed uploads into Weaviate at ingest time |
| `RAG_SHADOW` | off (default) / `1` | Run local retrieval alongside the OpenAI answer and log a comparison (observe-only) |
| `RAG_RETRIEVAL` | `openai` (default) / `local` | Replace hosted `file_search` with injected local Weaviate context (generation stays on the Responses API) |
| `RAG_GENERATION` | `openai` (default) / `local` | Route generation to OpenRouter (no hosted tools, local context only) |

### Rollout order (each step is reversible by flag)

1. `RAG_DUAL_WRITE=1` — populate Weaviate in parallel; reads still go to OpenAI.
2. `RAG_SHADOW=1` — compare local vs. OpenAI retrieval offline.
3. `RAG_RETRIEVAL=local` — answers grounded in local retrieval; generation still OpenAI.
4. `RAG_GENERATION=local` — generation via OpenRouter; the turn makes **no OpenAI calls**.

### Notes / current limitations

- In **local generation** mode there is no `code_interpreter` / `web_search`, and
  image / file attachments are not sent to the model (text + retrieved context only).
- Docling runs with OCR disabled, so **scanned / image-only PDFs** yield little local
  text (a local vision model is future work). Text PDFs work well.
- Embeddings are model-specific: changing `BGE_MODEL_NAME` requires re-ingesting.
- First run downloads the embedding (~90 MB) and reranker (~600 MB) models, plus
  Docling weights.

See `backend/README.md` → **Local RAG stack** for the model/Weaviate env vars and
the per-conversation scoping model.

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `AWS_ACCESS_KEY_ID` | Yes | S3 IAM key |
| `AWS_SECRET_ACCESS_KEY` | Yes | S3 IAM secret |
| `AWS_REGION` | Yes | e.g. `eu-north-1` |
| `AWS_S3_BUCKET` | Yes | Bucket for uploaded files |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Path to Firebase service account (auto-detected if absent) |
| `API_BASE_PATH` | No | Default `/api/policy_research` |
| `PORT` | No | Default `5029` |
| `MULTIMODAL_MODEL` | No | Default `gpt-4o` |
| `ROUTER_MODEL` | No | Default `gpt-4o-mini` |
| `AI_PROVIDER` / `RAG_*` | No | Local AI stack flags — see [Local AI stack](#local-ai-stack-optional) |
| `OPENROUTER_API_KEY` | No | Required only when generation/router runs locally (`*_local`) |
| `WEAVIATE_HOST` / `WEAVIATE_PORT` | No | Weaviate location (default `localhost:8090`; `weaviate:8080` in Docker) |
| `BGE_MODEL_NAME` / `RERANKER_MODEL_NAME` / `LLM_MODEL` | No | Local embedding / reranker / OpenRouter model overrides |

### Frontend (Next.js proxy, server-side)

| Variable | Description |
|---|---|
| `RESEARCH_API_URL` | Backend URL for the Next.js proxy (e.g. `http://backend:5029` in Docker, Cloud Run URL in prod) |

### Frontend (browser bundle, baked at build time)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_RESEARCH_WS_URL` | WebSocket URL the browser connects to (e.g. `ws://localhost:5029/ws`) |
| `NEXT_PUBLIC_RESEARCH_API_URL` | Direct backend URL from browser (optional — falls back to `/api` proxy) |
