# OpenAI RAG Stack Migration

**Date:** 2026-03-20
**Branch:** beta
**Status:** Complete

---

## Overview

This document describes the migration from our previous local/hybrid RAG stack to a fully OpenAI-powered pipeline.

### Why we migrated

The original stack required:
- **MinerU** (Python, GPU optional): Multi-GB model downloads, 20–60 min extraction per document, complex venv management.
- **BGE-M3** via `@xenova/transformers`: ~2.27 GB model loaded in Node.js, slow cold-start, GPU VRAM contention with MinerU.

Neither component scales well without dedicated GPU hardware. The new OpenAI stack runs anywhere with just an API key.

---

## What Changed

### 1. Embeddings — `embeddingGenerator.ts`

| | Before | After |
|---|---|---|
| Model | BGE-M3 (`Xenova/bge-m3`) | `text-embedding-3-small` |
| Dimensions | 1 024 | **1 536** |
| Runtime | Local ONNX (CPU/CUDA) | OpenAI API |
| Cold-start | ~30 s (model load) | Instant |
| Dependency | `@xenova/transformers` (2.27 GB) | None (uses existing `openai` pkg) |
| Token limit | 8 192 tokens | 8 191 tokens |
| Multilingual | Yes | Yes |

**Class name preserved** (`LocalEmbeddingGenerator`) — no changes needed in `ragChunk.ts` or `ragDocument.ts`.

**New env var:**
```env
EMBEDDING_MODEL=text-embedding-3-small   # default, override to text-embedding-3-large for higher accuracy
```

> **Important:** Because the vector dimension changed from 1 024 → 1 536, the Weaviate schema must be recreated and all documents re-ingested. See [Schema Recreation](#schema-recreation) below.

---

### 2. Document Extraction — `openaiExtractionService.ts` (new)

Replaces `mineruService.ts`. Uses **GPT-4o** for multimodal understanding.

#### Supported input types (new vs old)

| File type | Before (MinerU) | After (OpenAI) |
|---|---|---|
| PDF (text-based) | ✅ via MinerU OCR | ✅ via pdf-parse + GPT-4o cleaning |
| PDF (scanned/image) | ✅ via MinerU VLM | ✅ via pdfjs-dist rendering + GPT-4o vision |
| PNG / JPG / JPEG | ❌ Not supported | ✅ GPT-4o vision |
| GIF / WEBP / TIFF | ❌ Not supported | ✅ GPT-4o vision |

#### Extraction logic

```
Input file
│
├─ PDF?
│   ├─ Extract text with pdf-parse
│   ├─ If avg chars/page ≥ 80  → GPT-4o text-cleaning path
│   └─ If sparse (scanned)     → render pages to PNG via pdfjs-dist + canvas
│                                  → GPT-4o vision (batches of 5 pages)
│
└─ Image (PNG / JPG / GIF / WEBP / TIFF)?
    └─ Base64-encode → GPT-4o vision → Markdown
```

All results are saved to `extraction_results/<filename>.md` — identical to the MinerU behaviour so the existing ingestion script (`run-serve-and-ingest.sh`) works without modification.

**New env var:**
```env
EXTRACTION_MODEL=gpt-4o    # default; override to gpt-4o-mini for lower cost
```

---

### 3. File Extraction Service — `fileExtractionService.ts`

- Removed MinerU dependency (`mineruService.ts`)
- `extractionMethod` field changed from `'MINERU'` → `'OPENAI'`
- Now accepts images in addition to PDFs (expanded MIME type list)

---

### 4. Chat Controller — `chatController.ts`

- **Multer `fileFilter`** added: accepts PDF + PNG/JPG/GIF/WEBP/TIFF
- `extractionMethod` label updated to `'OPENAI'` in Firestore saves and API responses
- No changes to routes, WebSocket events, or ingestion flow

---

### 5. Dependencies — `package.json`

| Package | Change |
|---|---|
| `@xenova/transformers` | **Removed** — was 2.27 GB, no longer needed |
| `canvas` | Kept — used by pdfjs-dist for scanned PDF rendering |
| `pdf-parse` | Kept — fast text extraction for text-based PDFs |
| `pdfjs-dist` | Kept — PDF page rendering for scanned PDFs |
| `openai` | Already present via `@policysynth/agents` — now used directly for embeddings & extraction |

---

### 6. Environment Variables — `.env`

Removed (MinerU / GPU):
```env
GPU=true
MINERU_GPU_BACKEND=hybrid-auto-engine
VLLM_GPU_MEMORY_UTILIZATION=0.90
VLLM_MAX_MODEL_LEN=8192
VLLM_MAX_NUM_SEQS=32
MINERU_HYBRID_BATCH_RATIO=1
VLLM_USE_V1=0
VLLM_WORKER_MULTIPROC_METHOD=spawn
```

Added:
```env
EMBEDDING_MODEL=text-embedding-3-small
EXTRACTION_MODEL=gpt-4o
```

---

## Schema Recreation (Required)

Because the embedding dimension changed (1 024 → 1 536), Weaviate's existing `RagDocument` and `RagDocumentChunk` classes must be dropped and recreated before re-ingesting documents.

```bash
cd backend

# 1. Destroy existing schema (WARNING: deletes all indexed content)
npm run destroyWeaviateRagChunk
npm run destroyWeaviateRagDocument

# 2. Recreate schema
npm run createWeaviateRagDocument
npm run createWeaviateRagChunk

# 3. Re-ingest documents via the frontend upload flow
#    (or run the ingestion script directly for batch re-ingestion)
```

GeoJSON data (Catastro Minero) must also be re-ingested via the frontend or the `/ingest-geojson` endpoint.

---

## What Did NOT Change

The following components are **unchanged** and continue to work as before:

| Component | Status |
|---|---|
| Weaviate vector store (Docker) | Unchanged — still port 8080 |
| Hybrid BM25 + NearVector search (`ragDocument.ts`) | Unchanged |
| Cosine reranking | Unchanged |
| Geo-filters (DEPA / PROVI / DISTRI) | Unchanged |
| List-all pagination mode | Unchanged |
| Intent router (`router.ts`) | Unchanged |
| Vector search orchestrator (`vectorSearch.ts`) | Unchanged |
| Ingestion chunking (`agentProcessor.ts`) | Unchanged |
| GeoJSON converter (`geojsonConverter.ts`) | Unchanged |
| MCP geospatial server (`mcp-service/`) | Unchanged |
| Frontend (`research-chatbot.jsx`, `research-api.js`) | Unchanged |
| Firestore session persistence | Unchanged |
| WebSocket events | Unchanged |
| All API routes | Unchanged |

---

## Performance Comparison

| Metric | Before (MinerU + BGE-M3) | After (OpenAI) |
|---|---|---|
| PDF extraction time | 2–60 min (model load + OCR) | 5–30 s (API call) |
| Image extraction | Not supported | ~3–5 s per image |
| Embedding generation (cold start) | 30–120 s | < 1 s |
| Embedding generation (batch 100) | ~10 s (CPU) | ~2–3 s (API) |
| GPU/VRAM required | Yes (optional) | No |
| Memory footprint | +2–4 GB (models in RAM) | Minimal |

---

## Cost Estimate (OpenAI API)

All charged to the same `OPENAI_API_KEY` used for chat completions.

| Operation | Model | Approximate cost |
|---|---|---|
| 1 MB PDF extraction | gpt-4o | ~$0.05–0.15 depending on pages |
| Image extraction | gpt-4o | ~$0.01–0.03 per image |
| 1 000 chunk embeddings | text-embedding-3-small | ~$0.002 |
| Chat response | gpt-4o-mini (existing) | unchanged |

---

## Files Changed

```
backend/
├── src/
│   ├── vectorstore/
│   │   └── embeddingGenerator.ts          REWRITTEN — OpenAI embeddings
│   ├── services/
│   │   ├── openaiExtractionService.ts     NEW — replaces mineruService.ts
│   │   └── fileExtractionService.ts       UPDATED — uses OpenAI, supports images
│   └── controllers/
│       └── chatController.ts              UPDATED — fileFilter + method label
├── .env                                   UPDATED — removed MinerU vars, added OpenAI vars
└── package.json                           UPDATED — removed @xenova/transformers

docs/
└── OPENAI_RAG_MIGRATION.md               NEW — this file
```

`mineruService.ts` remains on disk as a reference but is no longer imported.
