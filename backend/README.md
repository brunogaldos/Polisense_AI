# Polisense — Python Backend

FastAPI backend for the Polisense policy-research platform. Provides the REST
API, WebSocket chat channel, document ingestion pipeline, and geospatial tools
consumed by the Next.js frontend.

The entire AI stack runs on **Google Cloud**:
- **Vertex AI RAG Engine** — per-conversation document corpora
- **Gemini Vision** (via Vertex AI) — image / scanned-PDF extraction
- **Google ADK** — agent orchestration (RAG retrieval + geospatial tools)
- **Google Earth Engine** — satellite NDVI / vegetation-stress analysis
- **Firebase / Firestore** — conversation and document metadata

---

## Table of Contents

1. [Google Stack — How It Works](#google-stack--how-it-works)
2. [Full Architecture Diagram](#full-architecture-diagram)
3. [Directory Structure](#directory-structure)
4. [Requirements](#requirements)
5. [Setup](#setup)
6. [Running the Server](#running-the-server)
7. [Environment Variables](#environment-variables)
8. [Chat Flow (ADK)](#chat-flow-adk)
9. [Document Ingestion Pipeline](#document-ingestion-pipeline)
10. [NDVI Mine Vegetation Analysis (MCP Tool)](#ndvi-mine-vegetation-analysis-mcp-tool)
11. [Geospatial MCP Service](#geospatial-mcp-service)
12. [Docker](#docker)

---

## Google Stack — How It Works

### 1 · Vertex AI RAG Engine (Document Q&A)

Every conversation gets its own **Vertex AI RAG Corpus**. When a user uploads
a document the backend:

1. Extracts text (pypdf for PDFs, openpyxl for spreadsheets, Gemini Vision for
   images and scanned pages).
2. Uploads the extracted Markdown to `rag.upload_file()` on the conversation's
   corpus.
3. Stores `ragCorpusName` and `ragFileId` in Firestore.

At query time the ADK `search_documents` tool calls `rag.retrieval_query()` with
a `RagRetrievalConfig(top_k=10)`, retrieves the top passages, and returns them
to the model as grounding context.

```
User upload
  │
  ├─ pypdf / openpyxl / Gemini Vision  →  Markdown text
  │
  └─ vertexai.rag.upload_file()
       ↓
  Vertex AI RAG Corpus  (projects/<id>/locations/us-central1/ragCorpora/<id>)
       ↓
  ragCorpusName  →  Firestore  chatbot_memories/<memory_id>
```

Race-safe corpus creation: a process-local `threading.Lock` per `memory_id`
plus a Firestore compare-and-set transaction ensures only one corpus is created
even under concurrent requests.

### 2 · Gemini Vision (Image OCR)

Image files (PNG, JPEG, TIFF) and scanned PDFs trigger
`GeminiExtractionService.extract_from_image()`:

```python
model = GenerativeModel("gemini-2.5-flash")   # or env GEMINI_CHAT_MODEL
image_part = Part.from_data(data=bytes, mime_type="image/png")
response = model.generate_content([image_part, "Extract ALL visible text as Markdown…"])
```

The extracted Markdown is then uploaded to the RAG corpus like any other file.

### 3 · Google ADK (Agent Orchestration)

All non-trivial chat turns go through a **Google ADK `LlmAgent`** backed by
Vertex AI Gemini. The agent has two tools:

| Tool | What it does |
|---|---|
| `search_documents` | Calls `VertexRagService.retrieval_query()` on the conversation's corpus |
| `run_geospatial_analysis` | Delegates to `handle_geospatial_query()` — spawns the MCP geo/NDVI server |

The ADK runner is a module-level singleton (`InMemoryRunner`); sessions are
keyed by `memory_id` so conversation history is preserved across turns.

Vertex AI authentication for the ADK model is handled by subclassing
`google.adk.models.google_llm.Gemini` and overriding `api_client` with a
`google.genai.Client(vertexai=True, credentials=<service_account>)`.

### 4 · Google Earth Engine (NDVI Analysis)

Vegetation-stress analysis is handled by a separate MCP subprocess
(`mcp-service/tools/mine_ndvi.py`) that authenticates to Earth Engine via
service account and runs a Sentinel-2 NDVI pipeline returning GeoJSON layers.
See [NDVI Mine Vegetation Analysis](#ndvi-mine-vegetation-analysis-mcp-tool).

### 5 · Firebase / Firestore

All conversation state lives in Firestore (`chatbot_memories` collection):
- `ragCorpusName` — Vertex AI RAG corpus resource name
- `ragFileId` — RAG file ID per uploaded document
- `chatLog` — full conversation history
- `extractionStatus` — document processing status (`rag_ready`, `processing`, …)

---

## Full Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (Next.js  ·  port 3000)                                       │
│  pages/api/policy_research/ ──HTTP──► FastAPI :8080                      │
│  WebSocket (research-api.js) ──WS───► /ws                                │
└────────────────────────┬─────────────────────────────────────────────────┘
                         │
         ┌───────────────▼───────────────┐
         │    FastAPI  (main.py)          │
         │    skills_first_chat_bot.py    │
         │                               │
         │  Regex pre-check              │
         │  ├─ DEEP_ANALYSIS   ──────────┼──► handle_geospatial_query()  ─┐
         │  ├─ DRAW_POLYGON    ──────────┼──► handle_draw_polygon()      ─┤
         │  ├─ OVERLAP         ──────────┼──► handle_overlap_analysis()  ─┤
         │  │                            │                                 │
         │  └─ everything else ──────────┼──► run_adk_conversation()      │
         └───────────────────────────────┘         │                       │
                                                   │                       │
                    ┌──────────────────────────────▼──────────┐            │
                    │  Google ADK  InMemoryRunner              │            │
                    │  LlmAgent  "polisense_agent"             │            │
                    │  model: Vertex AI Gemini                 │            │
                    │                                          │            │
                    │  ┌─────────────────────────────────┐    │            │
                    │  │  Tool: search_documents          │    │            │
                    │  │  VertexRagService.retrieval_query│    │            │
                    │  └──────────────┬──────────────────┘    │            │
                    │                 │                        │            │
                    │  ┌──────────────▼──────────────────┐    │            │
                    │  │  Tool: run_geospatial_analysis   │    │            │
                    │  │  → handle_geospatial_query()  ───┼────┼────────────┘
                    │  └─────────────────────────────────┘    │
                    └──────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼──────────────────────────┐
              │                       │                          │
   ┌──────────▼──────────┐  ┌─────────▼──────────┐  ┌──────────▼──────────┐
   │  VERTEX AI          │  │  GEMINI VISION       │  │  GeoMCPClient       │
   │  RAG Engine         │  │  (extraction)        │  │  stdio subprocess   │
   │                     │  │                      │  │                     │
   │  rag.create_corpus  │  │  GenerativeModel     │  │  JSON-RPC 2.0       │
   │  rag.upload_file    │  │  Part.from_data()    │  │  over stdin/stdout  │
   │  rag.retrieval_query│  │  → Markdown text     │  └──────────┬──────────┘
   └──────────┬──────────┘  └─────────────────────┘             │
              │                                        ┌──────────▼──────────┐
              │                                        │  MCP SERVICE         │
   ┌──────────▼──────────┐                            │  mcp-service/        │
   │  FIRESTORE           │                            │  server.py (FastMCP) │
   │  chatbot_memories    │                            │                      │
   │  ragCorpusName       │                            │  tools:              │
   │  ragFileId           │                            │  ├ place_pins        │
   │  chatLog             │                            │  ├ render_polygons   │
   └─────────────────────┘                            │  ├ compute_centroid  │
                                                       │  ├ create_buffer     │
   ┌─────────────────────┐                            │  ├ run_deep_analysis │
   │  AWS S3              │                            │  └ mine_ndvi ────────┼──► GOOGLE
   │  raw file storage    │                            └─────────────────────┘    EARTH
   └─────────────────────┘                                                        ENGINE
                                                                                  Sentinel-2
                                                                                  L2A archive
```

---

## Directory Structure

```
backend/
├── app/
│   ├── main.py                          Entry point — FastAPI app, all routes
│   ├── config/
│   │   └── firebase.py                  Firebase Admin init, Firestore client
│   ├── services/
│   │   ├── vertex_rag_service.py        Vertex AI RAG Engine (corpus CRUD + retrieval)
│   │   ├── firestore_memory_service.py  Read/write chatbot_memories collection
│   │   └── s3_storage_service.py        Upload / download document files
│   ├── ingestion/
│   │   ├── gemini_extraction_service.py Gemini Vision image OCR → Markdown
│   │   ├── openai_extraction_service.py Spreadsheet extraction (openpyxl, local only)
│   │   └── json_converter.py           GeoJSON / JSON → Markdown
│   ├── rag/                             LLM provider abstraction
│   │   └── providers/
│   │       ├── base.py
│   │       ├── gemini_provider.py       Vertex AI Gemini (default)
│   │       └── factory.py              get_provider / get_generation_provider
│   └── chatbot/
│       ├── base_chat_bot.py             WS helpers, Firestore memory, cost accounting
│       ├── adk_agent.py                 ADK LlmAgent, tools, InMemoryRunner singleton
│       ├── document_context_service.py  Resolves RAG corpus + doc list for a conversation
│       ├── skills_first_chat_bot.py     Main bot: ADK dispatch + geo handlers
│       ├── geo_mcp_client.py            MCP stdio client (spawns mcp-service)
│       └── geo_utils.py                UTM math, vertex parsing, centroid helpers
│
├── mcp-service/                         Geospatial + NDVI MCP server (FastMCP)
│   ├── server.py                        Tool definitions
│   ├── requirements.txt                 shapely, mcp[cli], earthengine-api, requests
│   ├── tools/
│   │   ├── geocatmin_spatial.py         Catastro Minero spatial queries
│   │   ├── geocode.py                   Geocoding helpers
│   │   ├── polygon_from_document.py     UTM polygon extraction
│   │   └── mine_ndvi.py                 Google Earth Engine NDVI pipeline
│   └── data/
│       └── Catastro.geojson             Mining concessions reference dataset
│
├── data/
│   └── dataLayout.json                  RAG router category config
│
├── Dockerfile                           python:3.11-slim, builds both venvs
├── requirements.txt                     Main app Python deps
├── start.sh                             Dev server (--reload, sources .env)
├── start-prod.sh                        Production server (sources .env.production)
├── .env.example                         Environment variable template
├── .env                                 Local secrets (git-ignored)
├── .env.production                      Production secrets (git-ignored)
└── google_serviceAccountKey.json        GCP service account (git-ignored)
```

---

## Requirements

| Requirement | Notes |
|---|---|
| Python 3.11 | 3.10 also works |
| GCP project | Vertex AI API + Earth Engine API + Firebase enabled |
| GCP service account | Roles: Vertex AI User, Earth Engine Viewer, Firebase Admin |
| AWS S3 bucket | Raw document file storage |
| Firebase project | Firestore in Native mode |

---

## Setup

### 1. Main app venv

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 2. MCP geo / NDVI service venv

The MCP service runs as an isolated subprocess with its own dependencies:

```bash
cd backend/mcp-service
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

> Without this venv the geospatial and NDVI features are disabled. The rest of
> the API (conversations, ingestion, chat) works fine without it.

### 3. Credentials

```bash
cp backend/.env.example backend/.env
# edit .env with your keys
```

Place your GCP service account JSON at `backend/google_serviceAccountKey.json`
and set:

```
GEMINI_SERVICE_ACCOUNT_KEY=google_serviceAccountKey.json
GOOGLE_APPLICATION_CREDENTIALS=google_serviceAccountKey.json
GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
GOOGLE_CLOUD_LOCATION=us-central1
```

---

## Running the Server

### Development (auto-reload)

```bash
cd backend
./start.sh
```

Server starts at **http://localhost:5029** (or `$PORT`).

### Production

```bash
cd backend
./start-prod.sh
```

Reads `.env.production`, falls back to `.env`. Single Uvicorn worker required —
the WebSocket client registry is in-process.

---

## Environment Variables

All variables are optional unless marked **required**.

### Google Cloud / Vertex AI

| Variable | Default | Description |
|---|---|---|
| `GEMINI_SERVICE_ACCOUNT_KEY` | — | **Required.** Path to GCP service account JSON |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Same file (Firebase + Vertex AI SDK) |
| `GOOGLE_CLOUD_PROJECT` | from SA key | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | Vertex AI region |
| `GEMINI_CHAT_MODEL` | `gemini-2.0-flash-001` | Chat + Vision model. Omit `google/` prefix. |

### Firebase

| Variable | Description |
|---|---|
| `FIREBASE_PROJECT_ID` | Firestore project |
| `FIREBASE_CLIENT_EMAIL` | Alternative to key file |
| `FIREBASE_PRIVATE_KEY` | Alternative to key file |

### AWS S3

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | **Required** |
| `AWS_SECRET_ACCESS_KEY` | **Required** |
| `AWS_REGION` | default `us-east-1` |
| `AWS_S3_BUCKET` | Bucket name |

### Google Earth Engine

| Variable | Description |
|---|---|
| `EE_PROJECT` | GCP project registered for Earth Engine |
| `EE_SERVICE_ACCOUNT` | Service account email with EE Viewer role |
| `EE_KEY_JSON` | Full service account JSON as single-quoted string |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5029` | Uvicorn port (Cloud Run injects `8080`) |
| `API_BASE_PATH` | `/api/policy_research` | Route prefix (production: `/policy_research`) |
| `RAG_RETRIEVAL_TOP_K` | `10` | Passages per `search_documents` call |

---

## Chat Flow (ADK)

```
PUT /  →  SkillsFirstChatBot.skills_first_conversation(chatLog, dataLayout)
             │
             ├─ Regex pre-check  (no LLM call)
             │   DEEP_ANALYSIS   →  handle_geospatial_query()
             │   DRAW_POLYGON    →  handle_draw_polygon_from_document()
             │   OVERLAP         →  handle_overlap_analysis()
             │
             └─ run_adk_conversation()
                    │
                    │  ADK InMemoryRunner singleton
                    │  session keyed by memory_id
                    │
                    ├─ search_documents tool
                    │     VertexRagService.retrieval_query(corpus, query, top_k)
                    │     passages injected as grounding context
                    │
                    ├─ run_geospatial_analysis tool
                    │     handle_geospatial_query(query)
                    │     GeoMCPClient → mcp-service subprocess
                    │     map WS events fire normally
                    │     text output captured → returned to model
                    │
                    └─ streaming final answer
                           partial events  →  WS "stream" frames
                           is_final_response()  →  WS "end"
                           persisted to Firestore chatLog
```

---

## Document Ingestion Pipeline

```
POST /ingest-pdf  (multipart)
  │
  ├─ S3 upload  (always — raw file backup)
  │
  ├─ MIME detection
  │   ├─ image/*      Gemini Vision → Markdown → rag.upload_file()
  │   ├─ .xlsx/.xls   openpyxl     → Markdown → rag.upload_file()
  │   └─ .pdf/other   direct            rag.upload_file()
  │
  └─ Firestore document record
       extractionStatus = "rag_ready"
       ragFileId + ragCorpusName stored
```

The RAG corpus for each conversation is created on first upload via a race-safe
compare-and-set (process lock + Firestore transaction). The corpus resource name
is stored as `ragCorpusName` in `chatbot_memories`.

---

## NDVI Mine Vegetation Analysis (MCP Tool)

Generates Sentinel-2 vegetation-stress GeoJSON layers around a mine site using
Google Earth Engine, exposed to the chatbot via the MCP protocol over stdio.

### How It Works

```
User message  ("ndvi" / "vci" / "vegetation stress" / "sentinel-2" / …)
    │
    │  regex match  OR  ADK routes to run_geospatial_analysis
    ▼
handle_geospatial_query()  →  GeoMCPClient
    │  asyncio.wait_for(call_tool(…), timeout=300 s)
    │  JSON-RPC 2.0 over stdin / stdout
    ▼
mcp-service/server.py  →  generate_mine_ndvi_geojson
    ▼
mcp-service/tools/mine_ndvi.py
    ├─ initialize_earth_engine()     service account auth
    ├─ make_mine_region()            Point + buffer geometry
    ├─ make_monthly_threshold()      baseline percentiles P10–P90
    ├─ make_current_monthly_ndvi()   current month median NDVI
    ├─ calculate_stress_layers()     VCI, anomaly, severity, class
    └─ vectorize_class_image() × 4  pixels → GeoJSON polygons
           │
           │  earthengine-api  COPERNICUS/S2_SR_HARMONIZED
           │  .getInfo() blocks until EE server returns
           ▼
    { layers: { mine_point, buffer, anomaly, vci, stress_class, severe_extreme } }
    │
    ▼
_dispatch_geo_tool()  →  WS  { type: "map_concessions", geojson: … }
    ▼
Frontend (Mapbox GL JS) — 6 layers rendered on interactive map
```

### Earth Engine Pipeline

```
Sentinel-2 L2A (COPERNICUS/S2_SR_HARMONIZED)
    │
    ├─ filterDate(baseline)   2019-01-01 → 2020-12-31
    ├─ filterBounds(mine_buffer)
    ├─ filter(CLOUDY_PIXEL_PERCENTAGE < 60)
    ├─ mask_s2_clouds_scl()   SCL classes 0,1,2,3,7,8,9,10,11 masked
    └─ add_s2_ndvi()          NDVI = (B8 − B4) / (B8 + B4)
            │
            ├─ BASELINE  calendarRange(month) → percentile(P10,P25,P50,P75,P90)
            └─ CURRENT   filterDate(year/month) → median()
                    │
                    └─ calculate_stress_layers()
                            ├─ ndvi_anomaly = current − P50
                            ├─ robust_vci   = (current − P10) / (P90 − P10) × 100
                            ├─ severity     = 1 − (vci / 100)
                            └─ stress_class = threshold(vci)
                                    ├─ classify_anomaly() → anomaly_class
                                    ├─ classify_vci()     → vci_class
                                    └─ stress_class ≥ 3   → severe_extreme
                                            └─ vectorize_class_image() × 4
                                               reduceToVectors() + getInfo()
                                               → GeoJSON FeatureCollection
```

### Output Layers

| Layer | Type | Description |
|---|---|---|
| `mine_point` | Point | Mine centre coordinate |
| `buffer` | Polygon | Analysis boundary (default 7 km) |
| `anomaly` | Polygons | NDVI deviation from historical median |
| `vci` | Polygons | Vegetation Condition Index (0–100) |
| `stress_class` | Polygons | 5-level stress classification |
| `severe_extreme` | Polygons | VCI < 20 patches (stress class ≥ 3) |

### Stress Classification

| Class | Label | VCI Range |
|---|---|---|
| 0 | normal_healthy | ≥ 50 |
| 1 | mild_stress | 35 – 50 |
| 2 | moderate_stress | 20 – 35 |
| 3 | severe_stress | 10 – 20 |
| 4 | extreme_stress | < 10 |

### Key Parameters

| Parameter | Default | Notes |
|---|---|---|
| `lon` / `lat` | required | Mine centre, WGS84 |
| `year` / `month` | required | Analysis period |
| `buffer_km` | 7.0 | Radius (km) |
| `scale` | 100 | Vectorisation resolution (m) |
| `min_patch_ha` | 5.0 | Min polygon area for severe_extreme |
| `max_features` | 1000 | Max polygons per layer |

### Authentication

Requires these env vars (inherited by the subprocess from the backend):

```
EE_PROJECT=<gcp-project-id>
EE_SERVICE_ACCOUNT=<name>@<project>.iam.gserviceaccount.com
EE_KEY_JSON='{"type":"service_account", ...}'
```

### NDVI Setup

```bash
cd backend/mcp-service
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

### Trigger Keywords

```
ndvi | vci | sentinel-2 | vegetation stress | vegetation health
vegetation condition | mine vegetation | vegetation anomaly | stress class
```

### Performance Notes

- **Timeout:** 300 s hard ceiling on the tool call.
- **Scale:** 100 m default. Lower values produce finer polygons but are 10–20× slower.
- **Bottleneck:** `reduceToVectors().getInfo()` — EE vectorises server-side then
  serialises the FeatureCollection through stdio.

---

## Geospatial MCP Service

The Catastro Minero geo service also runs as an stdio MCP subprocess.
`GeoMCPClient` spawns `mcp-service/server.py`, calls tools via JSON-RPC 2.0,
and streams the resulting GeoJSON to the frontend over WebSocket.

### Available Tools

| Tool | Description |
|---|---|
| `place_pins` | Geocode locations → GeoJSON points |
| `render_polygons` | UTM coordinates → polygon GeoJSON |
| `compute_centroid` | Centroid of a polygon set |
| `create_buffer` | Buffer a point by radius |
| `run_deep_analysis` | Spatial analysis vs Catastro.geojson + HTML panel |
| `generate_mine_ndvi_geojson` | Sentinel-2 NDVI/VCI layers (see above) |

### Python Interpreter Resolution

1. `mcp-service/venv/bin/python` — dedicated venv (recommended)
2. `$PYTHON_EXECUTABLE` environment variable
3. `python3` system default

---

## Docker

Build context must be the **repo root**:

```bash
docker build -f backend/Dockerfile -t <image-name> .
docker push <image-name>
```

The Dockerfile:
1. `python:3.11-slim` base + `libgeos-dev` (shapely).
2. Builds `mcp-service/venv` as a separate cached layer.
3. Builds `.venv` for the main app.
4. Copies app source, data, MCP service, both service account key files,
   `.env`, and `.env.production`.
5. CMD is `start-prod.sh` — sources `.env.production` (sets correct
   `API_BASE_PATH`, no `--reload`).
6. Exposes port `8080` (Cloud Run standard).

### Cloud Run Deployment

```bash
gcloud run deploy backend-app \
  --image <image-name> \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated
```

Cloud Run injects `PORT=8080` automatically; `start-prod.sh` picks it up.

> **Security note:** `google_serviceAccountKey.json` and `.env.production` are
> baked into the image. For stricter deployments, mount them as Cloud Run
> secrets instead of copying them into the image.
