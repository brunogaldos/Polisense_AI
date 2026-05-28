# Google Cloud Run Deployment Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Google Cloud Run Requirements](#google-cloud-run-requirements)
4. [Docker Configuration](#docker-configuration)
5. [Weaviate Vector Database Configuration](#weaviate-vector-database-configuration)
6. [File Processing Pipeline](#file-processing-pipeline)
7. [Code Changes for Cloud Run Compatibility](#code-changes-for-cloud-run-compatibility)
8. [Deployment Process](#deployment-process)
9. [Environment Variables](#environment-variables)
10. [File Structure](#file-structure)
11. [Memory Management and Optimization](#memory-management-and-optimization)
12. [Performance Considerations](#performance-considerations)
13. [Troubleshooting](#troubleshooting)
14. [References](#references)

---

## Overview

This guide documents how the Polisense backend application is deployed to **Google Cloud Run**, a fully managed serverless platform that automatically scales your containers.

### Key Benefits of Cloud Run

- **Serverless**: No infrastructure management required
- **Auto-scaling**: Automatically scales based on traffic
- **Pay-per-use**: Only pay for requests processed
- **HTTPS by default**: Automatic TLS certificates
- **Global deployment**: Deploy to any Google Cloud region

### Application Components

- **Backend API**: Node.js/Express/TypeScript application
- **WebSocket Server**: Real-time communication for chat
- **File Processing**: PDF extraction using MinerU (Python)
- **RAG Pipeline**: Document ingestion and vector search
- **Embedding Generation**: Using @xenova/transformers (BGE-M3 model)
- **Vector Database**: Weaviate (hosted externally on Cloud Run)

---

## Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Cloud Run                          │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Container Instance (Stateless)              │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │        Node.js Application                    │  │    │
│  │  │  - Express HTTP Server (0.0.0.0:PORT)        │  │    │
│  │  │  - WebSocket Server (/ws)                     │  │    │
│  │  │  - Health Check Endpoint (/health)            │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │        Python Runtime                        │  │    │
│  │  │  - MinerU PDF Extraction                     │  │    │
│  │  │  - Virtual Environment (/opt/mineru-venv)    │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │        File System (Ephemeral)                │  │    │
│  │  │  - /app/extraction_results/                   │  │    │
│  │  │  - /app/cache/                                │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │                                                      │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              External Services (HTTPS)                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Weaviate Vector Database                            │   │
│  │  https://weaviate-872928420418.europe-west1.run.app │   │
│  │  - RagDocument schema (document metadata)            │   │
│  │  - RagChunk schema (text chunks with embeddings)     │   │
│  │  - API Key authentication                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Firestore (Document Storage)                        │   │
│  │  - Chat conversations                                │   │
│  │  - User data                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OpenAI API (LLM)                                    │   │
│  │  - GPT-4o-mini for chat                              │   │
│  │  - Text generation                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Google Search API                                   │   │
│  │  - Web search for research                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

```
Client Request (HTTPS)
    │
    ▼
Cloud Run Load Balancer
    │
    ▼
Container Instance (Auto-scaled)
    │
    ▼
Express Server (0.0.0.0:PORT)
    │
    ├─► REST API Endpoints (/policy_research/*)
    │   └─► ChatController
    │       ├─► File Upload → MinerU Extraction
    │       ├─► RAG Ingestion → Weaviate
    │       └─► Chat Query → RAG Retrieval → Weaviate
    │
    ├─► WebSocket Endpoint (/ws)
    │   └─► WebSocket Server (Real-time chat)
    │
    └─► Health Check (/health)
        └─► Returns 200 OK

Document Processing Flow:
    PDF Upload
        │
        ▼
    MinerU Extraction (Python)
        │ (10 second delay for memory cleanup)
        ▼
    Markdown Cleaning
        │
        ▼
    RAG Ingestion Pipeline
        ├─► BGE-M3 Embedding Generation
        ├─► Chunking
        └─► Weaviate Storage
            ├─► RagDocument (metadata)
            └─► RagChunk (embeddings + text)
```

---

## Google Cloud Run Requirements

### Critical Requirements for Cloud Run

1. **Port Binding**: Must bind to `0.0.0.0` (all interfaces), not `localhost` or `127.0.0.1`
2. **Port Environment Variable**: Must use `PORT` environment variable set by Cloud Run
3. **Startup Timeout**: Container must start and listen within 240 seconds (default)
4. **Health Checks**: Respond to TCP connection on the specified port
5. **Stateless**: No persistent storage (filesystem is ephemeral)
6. **Graceful Shutdown**: Handle SIGTERM signals properly

### Port Configuration

Cloud Run automatically sets the `PORT` environment variable. The application must:
- Read `process.env.PORT` (not hardcoded)
- Default to `5029` if `PORT` is not set (for local development)
- Bind to `0.0.0.0` to accept connections from Cloud Run's health checker

---

## Weaviate Vector Database Configuration

### Overview

**Weaviate** is a vector database used for storing document embeddings and enabling semantic search in the RAG (Retrieval Augmented Generation) pipeline. In this deployment, Weaviate is hosted **externally** on Google Cloud Run as a separate service.

### Weaviate Instance Details

- **Host**: `weaviate-872928420418.europe-west1.run.app`
- **Scheme**: `https`
- **Authentication**: API Key-based
- **API Key**: `YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw`

### Why External Weaviate?

Weaviate is deployed separately from the backend application for several reasons:

1. **Persistence**: Vector database data should persist independently of backend restarts
2. **Scaling**: Weaviate can scale independently based on vector search load
3. **Cost Optimization**: Separate resource allocation allows better cost management
4. **Separation of Concerns**: Database and application logic are decoupled

### Weaviate Schemas

The application uses two main Weaviate schemas:

#### 1. RagDocument Schema

Stores document-level metadata:
- `title`: Document title
- `url`: Source URL or document identifier
- `description`: Document summary
- `contentType`: MIME type (e.g., "application/pdf")
- `documentMetaData`: Additional metadata as JSON

**Class Name**: `RagDocument`

#### 2. RagChunk Schema

Stores text chunks with embeddings:
- `uncompressedContent`: Full chunk text
- `compressedContent`: Compressed/truncated version
- `chunkIndex`: Position in document
- `chapterIndex`: Chapter/section number
- `shortSummary`: Brief summary
- `fullSummary`: Detailed summary
- Vector embedding: 1024-dimensional vector (BGE-M3 model)

**Class Name**: `RagChunk`

### Configuration in Application

Weaviate connection is configured through environment variables, with hardcoded defaults in startup scripts for Cloud Run deployment.

#### Environment Variables

```bash
WEAVIATE_API_KEY=<api-key>
WEAVIATE_HOST=<weaviate-host>
WEAVIATE_HTTP_SCHEME=<http|https>
```

**Default Values** (hardcoded in scripts for production):
- `WEAVIATE_API_KEY`: `YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw`
- `WEAVIATE_HOST`: `weaviate-872928420418.europe-west1.run.app`
- `WEAVIATE_HTTP_SCHEME`: `https`

### Schema Creation on Startup

The application automatically creates Weaviate schemas on container startup to ensure they exist before the first query.

**Location**: `backend/start-prod.sh`

**Process**:
1. Export Weaviate configuration (API key, host, scheme)
2. Copy schema JSON files to compiled output directory
3. Run `createRagDocument.js` to create `RagDocument` schema
4. Run `createRagChunk.js` to create `RagChunk` schema

**Code Snippet**:

```bash
# Export Weaviate Configuration
export WEAVIATE_API_KEY="YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw"
export WEAVIATE_HOST="weaviate-872928420418.europe-west1.run.app"
export WEAVIATE_HTTP_SCHEME="https"

# Copy schema files if they exist
if [ -d "src/vectorstore/schemas" ] && [ ! -d "ts-out/src/vectorstore/schemas" ]; then
  echo "   📂 Copying schema files to compiled output..."
  mkdir -p ts-out/src/vectorstore
  cp -R src/vectorstore/schemas ts-out/src/vectorstore/ 2>/dev/null || true
fi

# Create RagDocument schema (idempotent - safe to run multiple times)
echo "   📄 Creating RagDocument schema..."
if [ -f "ts-out/src/vectorstore/tools/createRagDocument.js" ]; then
  node ts-out/src/vectorstore/tools/createRagDocument.js || {
    echo "   ⚠️  Warning: Failed to create RagDocument schema (may already exist or Weaviate unavailable)"
    echo "   Continuing anyway - schema creation is idempotent"
  }
fi

# Create RagChunk schema (idempotent - safe to run multiple times)
echo "   📄 Creating RagChunk schema..."
if [ -f "ts-out/src/vectorstore/tools/createRagChunk.js" ]; then
  node ts-out/src/vectorstore/tools/createRagChunk.js || {
    echo "   ⚠️  Warning: Failed to create RagChunk schema (may already exist or Weaviate unavailable)"
    echo "   Continuing anyway - schema creation is idempotent"
  }
fi
```

**Schema Creation Scripts**:

- **`createRagDocument.ts`**: Creates the `RagDocument` schema
  ```typescript
  import { PsRagDocumentVectorStore } from "../ragDocument.js";

  async function run() {
      const store = new PsRagDocumentVectorStore();
      await store.addSchema();
      process.exit(0);
  }

  run();
  ```

- **`createRagChunk.ts`**: Creates the `RagChunk` schema
  ```typescript
  import { PsRagChunkVectorStore } from "../ragChunk.js";

  async function run() {
      const store = new PsRagChunkVectorStore();
      await store.addSchema();
      process.exit(0);
  }

  run();
  ```

### Weaviate Client Configuration

The Weaviate client is configured in the vectorstore classes using environment variables:

**File**: `backend/src/vectorstore/ragDocument.ts`

```typescript
static client: WeaviateClient = (weaviate as any).client({
  scheme: process.env.WEAVIATE_HTTP_SCHEME || "http",
  host: process.env.WEAVIATE_HOST || "localhost:8080",
  apiKey: new (weaviate as any).ApiKey(PsRagDocumentVectorStore.weaviateKey),
  headers: {
    'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
  },
});

private static getWeaviateKey(): string {
  const key = process.env.WEAVIATE_API_KEY || "";
  console.log(`Weaviate API Key: ${key ? 'Retrieved successfully' : 'Not found or is empty'}`);
  return key;
}
```

**File**: `backend/src/vectorstore/ragChunk.ts`

Similar configuration for `RagChunk` vector store.

### Configuration in RAG Ingestion Scripts

The RAG ingestion scripts (`run-rag-ingestion.sh` and `run-serve-and-ingest.sh`) also export Weaviate configuration:

**File**: `backend/run-rag-ingestion.sh`

```bash
# Export Weaviate Configuration
export WEAVIATE_APIKEY=YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw
export WEAVIATE_API_KEY="${WEAVIATE_APIKEY}"  # Also set WEAVIATE_API_KEY for compatibility

# Export WEAVIATE_HOST and scheme (Weaviate hosted on Cloud Run)
export WEAVIATE_HOST="weaviate-872928420418.europe-west1.run.app"
export WEAVIATE_HTTP_SCHEME="https"
```

**File**: `backend/run-serve-and-ingest.sh`

```bash
# Export Weaviate Configuration
export WEAVIATE_APIKEY="YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw"
export WEAVIATE_HOST="weaviate-872928420418.europe-west1.run.app"
export WEAVIATE_HTTP_SCHEME="https"
export WEAVIATE_API_KEY="${WEAVIATE_APIKEY}" # Also set WEAVIATE_API_KEY for compatibility
```

### Testing Weaviate Connection

To verify Weaviate is accessible from the backend container:

```bash
# Test connection
curl -H "Authorization: Bearer YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw" \
     https://weaviate-872928420418.europe-west1.run.app/v1/meta

# List schemas
curl -H "Authorization: Bearer YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw" \
     https://weaviate-872928420418.europe-west1.run.app/v1/schema
```

### Troubleshooting Weaviate Connection

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:8080`

**Cause**: Application is trying to connect to localhost instead of external Weaviate host.

**Solution**: 
1. Verify `WEAVIATE_HOST` is set correctly in startup scripts
2. Check that `WEAVIATE_HTTP_SCHEME` is set to `https` (not `http`)
3. Ensure Weaviate API key is exported before schema creation

**Error**: `Failed to create RagDocument schema`

**Cause**: Weaviate is unavailable or API key is incorrect.

**Solution**:
1. Check Weaviate service is running: `curl https://weaviate-872928420418.europe-west1.run.app/v1/meta`
2. Verify API key matches Weaviate configuration
3. Check network connectivity from Cloud Run container to Weaviate

**Error**: Schema already exists

**Note**: This is not an error. Schema creation is **idempotent** - running it multiple times is safe. The scripts will log a warning but continue.

---

## Docker Configuration

### Dockerfile Overview

**File**: `backend/Dockerfile`

The Dockerfile is optimized for Cloud Run deployment:

```dockerfile
# Use Node.js 20 slim image
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Puppeteer dependencies
    chromium chromium-sandbox fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgbm1 libgcc1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    # Utilities
    bash curl ca-certificates gnupg \
    # Build tools for native modules
    build-essential python3-dev \
    # libvips for sharp image processing
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for internal docker-compose support)
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Python 3 and create virtual environment for MinerU
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv python3-full \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environments for MinerU (CPU-only)
RUN python3 -m venv /opt/mineru-venv && \
    python3 -m venv /root/.venv

# Install MinerU with CPU-only PyTorch (no GPU dependencies)
RUN /opt/mineru-venv/bin/pip install --upgrade pip && \
    /opt/mineru-venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    /opt/mineru-venv/bin/pip install "mineru[pipeline]" && \
    /root/.venv/bin/pip install --upgrade pip && \
    /root/.venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    /root/.venv/bin/pip install "mineru[pipeline]"

# Add venv to PATH
ENV PATH="/opt/mineru-venv/bin:/root/.venv/bin:${PATH}"

# Set working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY backend/package.json backend/package-lock.json ./
COPY backend/patches/ ./patches/
RUN npm install && npm cache clean --force

# Copy TypeScript config and source code
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
COPY backend/scripts/ ./scripts/
RUN chmod +x scripts/*.py 2>/dev/null || true

# Build TypeScript to JavaScript
RUN set +e; \
    npx tsc --project ./tsconfig.json --outDir ./ts-out --skipLibCheck 2>&1 | head -100; \
    TSC_EXIT=$?; \
    COMPILED_COUNT=$(find ts-out -name "*.js" 2>/dev/null | wc -l); \
    if [ $TSC_EXIT -ne 0 ] && [ $COMPILED_COUNT -eq 0 ]; then \
        echo "❌ TypeScript compilation failed - no files compiled"; \
        exit 1; \
    fi; \
    if [ -f "ts-out/src/server.js" ]; then \
        echo "✅ Compiled ts-out/src/server.js"; \
    elif [ -f "ts-out/server.js" ]; then \
        echo "✅ Compiled ts-out/server.js"; \
    else \
        echo "❌ ERROR: server.js not found after compilation"; \
        exit 1; \
    fi; \
    set -e

# Copy startup scripts
COPY backend/start.sh backend/start-prod.sh ./
RUN chmod +x start.sh start-prod.sh

# Copy configuration files
COPY backend/serviceAccountKey.json ./
COPY backend/.env ./

# Configure Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose port (Cloud Run will override this)
EXPOSE 5029

# Start the production server
CMD ["./start-prod.sh"]
```

### Key Dockerfile Features

1. **Multi-stage dependencies**: Separates system packages, Python packages, and Node.js packages
2. **Layer caching**: Optimizes COPY commands for better cache utilization
3. **CPU-only PyTorch**: Avoids downloading CUDA/GPU dependencies (saves time and space)
4. **TypeScript compilation**: Builds JavaScript at image build time (not runtime)
5. **Scripts included**: Copies Python scripts needed for MinerU extraction

### Build Context

**Important**: The Docker build context must be the **repository root** (`Polisense/`), not the `backend/` directory.

```bash
# ✅ Correct: Build from repo root
cd /path/to/Polisense
docker build -f backend/Dockerfile -t backend-app .

# ❌ Wrong: Building from backend directory
cd backend
docker build -f Dockerfile -t backend-app .
```

---

## File Processing Pipeline

### Overview

The application processes uploaded PDF files through a multi-stage pipeline:

1. **File Upload** → In-memory buffer (multer)
2. **MinerU Extraction** → PDF to markdown conversion
3. **Markdown Cleaning** → Remove extraction artifacts
4. **Memory Delay** → 10-second pause for memory cleanup
5. **RAG Ingestion** → Generate embeddings and store in Weaviate

### Pipeline Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    File Upload Endpoint                          │
│              POST /policy_research/extract                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  1. File Received (multer)            │
        │     - Stored in memory buffer          │
        │     - Max size: 50MB                   │
        │     - Returns 202 Accepted immediately │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  2. MinerU Extraction                 │
        │     - Python process spawns           │
        │     - Loads models (~500MB-1GB)       │
        │     - Extracts PDF → Markdown         │
        │     - Saves to extraction_results/    │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  3. Extraction Complete               │
        │     - Markdown file ready             │
        │     - Python process exits            │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  4. 10-Second Delay                   │
        │     - Wait for memory cleanup         │
        │     - Python GC completes             │
        │     - System reclaims memory          │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  5. RAG Ingestion Script Triggered    │
        │     run-serve-and-ingest.sh           │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  6. Markdown Cleaning                 │
        │     - scripts/clean_markdown.py       │
        │     - Removes extraction artifacts    │
        │     - Formats for ingestion           │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  7. RAG Ingestion Pipeline            │
        │     - Load BGE-M3 model (~2.27GB)     │
        │     - Generate embeddings             │
        │     - Chunk documents                 │
        │     - Store in Weaviate               │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  8. Completion Notification           │
        │     - WebSocket message sent          │
        │     - Client notified of completion   │
        └───────────────────────────────────────┘
```

### Implementation Details

#### 1. File Upload Handler

**File**: `backend/src/controllers/chatController.ts`

```typescript
private extractFile = async (req: express.Request, res: express.Response) => {
  const file = (req as any).file;
  const fileBuffer: Buffer = file.buffer; // File already in memory
  
  // Generate fileId
  const timestamp = Date.now();
  const randomSuffix = Math.round(Math.random() * 1E9).toString(36);
  const fileId = `${timestamp}_${randomSuffix}`;
  
  // Extract memoryId and userId for document scoping
  const memoryId = req.body?.memoryId || req.query?.memoryId;
  const userId = req.body?.userId || req.query?.userId;
  
  // Return 202 Accepted immediately (async processing)
  res.status(202).json({
    fileId: fileId,
    message: 'File received, processing started',
    status: 'processing'
  });
  
  // Process file asynchronously
  this.processFileExtraction(fileBuffer, fileId, memoryId, userId);
};
```

**Key Features**:
- **In-memory storage**: Uses `multer.memoryStorage()` for fast file handling
- **Async processing**: Returns 202 immediately, processes in background
- **50MB limit**: Maximum file size constraint

#### 2. MinerU Extraction

**File**: `backend/src/services/mineruService.ts`

```typescript
async extractFromPDF(pdfBuffer: Buffer, outputPath: string): Promise<string> {
  // Use Python virtual environment
  let pythonCmd = 'python3';
  const optVenvPython = '/opt/mineru-venv/bin/python3';
  
  if (existsSync(optVenvPython)) {
    pythonCmd = optVenvPython;
    console.log(`🐍 MinerU: Using /opt/mineru-venv/bin/python3 (Docker container)`);
  }
  
  // Run MinerU extraction
  const scriptPath = join(process.cwd(), 'scripts', 'mineru_extract.py');
  const command = `${pythonCmd} ${scriptPath} "${pdfPath}" "${outputDir}"`;
  
  // Execute extraction...
  const markdown = await fs.readFile(markdownPath, 'utf-8');
  return markdown;
}
```

**Memory Usage**: ~500MB-1GB during extraction (Python process with models loaded)

#### 3. Memory Delay Implementation

**File**: `backend/src/controllers/chatController.ts`

```typescript
// After MinerU extraction completes
const delaySeconds = 10; // 10 seconds delay to allow memory cleanup

console.log(`🔄 Will trigger post-extraction script in ${delaySeconds} seconds`);
console.log(`   (Waiting to allow MinerU Python process to exit and release memory)`);

setTimeout(() => {
  console.log(`🚀 Starting post-extraction script: ${scriptPath}`);
  
  // Spawn RAG ingestion script with environment variables
  const scriptProcess = spawn('bash', [scriptPath, markdownFileName], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MEMORY_ID: memoryId,
      USER_ID: userId,
      MARKDOWN_FILENAME: markdownFileName
    }
  });
  
  // Monitor script output
  scriptProcess.stdout.on('data', (data) => {
    console.log(`[Post-extraction script] ${data.toString().trim()}`);
  });
  
  scriptProcess.unref(); // Allow Node.js to exit even if script is still running
}, delaySeconds * 1000);
```

**Why 10 Seconds?**:
- MinerU Python process exit: ~2-3 seconds
- Python garbage collection: ~2-3 seconds
- System memory reclamation: ~2-4 seconds
- Safety margin: ~1-2 seconds

#### 4. RAG Ingestion Script

**File**: `backend/run-serve-and-ingest.sh`

This script orchestrates the RAG ingestion process:

```bash
#!/bin/bash

# Export Weaviate Configuration
export WEAVIATE_APIKEY="YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw"
export WEAVIATE_HOST="weaviate-872928420418.europe-west1.run.app"
export WEAVIATE_HTTP_SCHEME="https"

# Run RAG ingestion script
env MEMORY_ID="$MEMORY_ID" USER_ID="$USER_ID" DOCUMENT_PATH="$DOCUMENT_PATH" \
    WEAVIATE_API_KEY="$WEAVIATE_API_KEY" WEAVIATE_HOST="$WEAVIATE_HOST" \
    WEAVIATE_HTTP_SCHEME="$WEAVIATE_HTTP_SCHEME" \
    ./run-rag-ingestion.sh &
```

**Features**:
- Preserves `MEMORY_ID` and `USER_ID` for document scoping
- Configures Weaviate connection
- Runs ingestion in background (monitors process)

#### 5. Markdown Cleaning

**File**: `backend/scripts/clean_markdown.py`

Cleans MinerU-extracted markdown:
- Removes extraction artifacts
- Fixes formatting issues
- Prepares for embedding generation

**Location**: `backend/extraction_results/<filename>.md`

#### 6. RAG Ingestion

**File**: `backend/run-rag-ingestion.sh`

This script:
1. Cleans markdown file
2. Builds TypeScript (if needed)
3. Runs ingestion pipeline:
   - Loads BGE-M3 embedding model (~2.27GB)
   - Generates embeddings for document chunks
   - Stores in Weaviate:
     - `RagDocument` (metadata)
     - `RagChunk` (embeddings + text)

### Directory Structure

```
/app/
├── extraction_results/          # Created on startup (ephemeral)
│   └── <fileId>_<filename>.md  # Extracted markdown files
├── scripts/
│   ├── mineru_extract.py       # MinerU extraction wrapper
│   └── clean_markdown.py       # Markdown cleaning script
├── run-serve-and-ingest.sh     # RAG ingestion orchestrator
└── run-rag-ingestion.sh        # Main RAG ingestion script
```

### Error Handling

**MinerU Extraction Fails**:
- Falls back to "TEXT" extraction method
- Logs error, continues with available content
- May skip RAG ingestion if no markdown generated

**RAG Ingestion Fails**:
- Logs detailed error messages
- WebSocket notification sent to client
- Document may be partially ingested

**Memory Errors**:
- Check delay is 10 seconds
- Verify memory limit is 6Gi
- Review concurrent request handling

---

## Code Changes for Cloud Run Compatibility

### 1. Custom Express Application

**File**: `backend/src/customApp.ts`

**Problem**: The original `PolicySynthApiApp` class tried to connect to Redis (localhost:6379) which doesn't exist in Cloud Run, causing startup failures.

**Solution**: Created `CustomPolicySynthApiApp` that:
- Does not extend `PolicySynthApiApp` (avoids Redis dependency)
- Uses memory-based sessions (no Redis required)
- Binds to `0.0.0.0` for Cloud Run health checks
- Implements proper CORS handling

```typescript
export class CustomPolicySynthApiApp {
  public app: Application;
  public port: number;
  public httpServer: HttpServer;
  public ws: WebSocketServer;
  public wsClients: Map<string, WebSocket> = new Map();

  constructor(controllers: any[], port?: number) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.port = port || parseInt(process.env.PORT || '8000');

    // Set up WebSocket server
    this.ws = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.setupWebSocket();

    // Initialize in the correct order
    this.initializeMiddlewares();
    this.initializeControllers(controllers);
  }

  async listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Set up error handler BEFORE calling listen
      this.httpServer.once('error', (error: Error) => {
        console.error('❌ Server error:', error.message);
        reject(error);
      });

      // Bind to 0.0.0.0 to allow Cloud Run health checks
      // Cloud Run requires the server to listen on all interfaces
      this.httpServer.listen(this.port, '0.0.0.0', () => {
        console.log(`✅ Server listening on port ${this.port} (0.0.0.0)`);
        resolve();
      });
    });
  }

  initializeMiddlewares() {
    // Handle OPTIONS requests FIRST - before anything else
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        // Set all required CORS headers
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,HEAD,PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control,X-HTTP-Method-Override');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(200).end();
      }
      next();
    });

    // CORS middleware for all requests
    this.app.use(cors({
      origin: (origin, callback) => callback(null, true),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
      allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control', 'X-HTTP-Method-Override']
    }));

    // Memory-based sessions (no Redis required)
    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'cloud-run-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));

    // Add health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
      });
    });
  }
}
```

### 2. Server Entry Point

**File**: `backend/src/server.ts`

**Changes**:
- Uses `PORT` environment variable from Cloud Run
- Creates required directories on startup
- Uses `CustomPolicySynthApiApp` instead of `PolicySynthApiApp`

```typescript
import { CustomPolicySynthApiApp } from './customApp.js';
import { ChatController } from './controllers/chatController.js';
import { PolicyResearchController } from './controllers/policyResearchController.js';

// Create required directories on startup (Cloud Run containers are stateless)
import { mkdir } from 'fs/promises';
import { join } from 'path';

async function initializeDirectories() {
  const extractionResultsDir = join(process.cwd(), 'extraction_results');
  try {
    await mkdir(extractionResultsDir, { recursive: true });
    console.log(`✅ Created/verified extraction_results directory: ${extractionResultsDir}`);
  } catch (error) {
    console.error(`⚠️  Warning: Could not create extraction_results directory:`, error);
  }
}

// Initialize directories before starting server
await initializeDirectories();

// Use PORT env var (Cloud Run sets this) or default to 5029
const port = parseInt(process.env.PORT || '5029', 10);

console.log(`🚀 Starting backend server on port ${port}...`);

const app = new CustomPolicySynthApiApp([
  ChatController,
  PolicyResearchController
],
port,
);

app.listen()
  .then(() => {
    console.log(`✅ Server listening on port ${port} (0.0.0.0)`);
  })
  .catch((error) => {
    console.error('❌ Failed to start server:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
```

### 3. Production Startup Script

**File**: `backend/start-prod.sh`

**Purpose**: Entrypoint script that runs the compiled JavaScript server directly (no nodemon in production).

```bash
#!/usr/bin/env bash
set -euo pipefail

# Always run from /app (the Dockerfile WORKDIR)
cd /app

# Find server.js in either location (ts-out/server.js or ts-out/src/server.js)
if [ -f "ts-out/src/server.js" ]; then
  SERVER_FILE="ts-out/src/server.js"
elif [ -f "ts-out/server.js" ]; then
  SERVER_FILE="ts-out/server.js"
else
  SERVER_FILE=""
fi

# Load variables from .env file if it exists
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
elif [[ -f ../.env ]]; then
  set -a
  source ../.env
  set +a
fi

# Check for compiled server
if [ -z "$SERVER_FILE" ]; then
  echo "❌ ERROR: Compiled server not found"
  echo "   Looking for ts-out/server.js or ts-out/src/server.js"
  find ts-out -name "server.js" 2>/dev/null || echo "   server.js not found"
  exit 1
fi

echo "🚀 Starting backend server on port ${PORT:-5029}..."

# Use exec to replace the shell process with node (better for Docker signals)
exec node "$SERVER_FILE"
```

**Key Features**:
- Handles both `ts-out/server.js` and `ts-out/src/server.js` (TypeScript compilation can output to either)
- Loads `.env` file if present
- Uses `exec` to ensure proper signal handling (SIGTERM, SIGINT)

### 4. Directory Initialization

**File**: `backend/src/server.ts`

Since Cloud Run containers are stateless and ephemeral, the filesystem doesn't exist on startup. The code creates required directories:

```typescript
async function initializeDirectories() {
  const extractionResultsDir = join(process.cwd(), 'extraction_results');
  try {
    await mkdir(extractionResultsDir, { recursive: true });
    console.log(`✅ Created/verified extraction_results directory: ${extractionResultsDir}`);
  } catch (error) {
    console.error(`⚠️  Warning: Could not create extraction_results directory:`, error);
  }
}

// Initialize directories before starting server
await initializeDirectories();
```

### 5. Route Path Configuration

**File**: `backend/src/controllers/chatController.ts`

Routes are configured to match frontend expectations:

```typescript
export class ChatController extends BaseController {
  public path = "/policy_research";  // Without /api prefix for Cloud Run

  public async initializeRoutes() {
    // PUT /policy_research/ - Start new conversation
    this.router.put(this.path + "/", this.skillsFirstChat);
    
    // GET /policy_research/conversations - Get user's conversation list
    this.router.get(this.path + "/conversations", this.getUserConversations);
    
    // GET /policy_research/:memoryId - Get chat log
    this.router.get(this.path + "/:memoryId", this.getChatLog);
    
    // ... other routes
  }
}
```

---

## Deployment Process

### Prerequisites

1. **Google Cloud SDK**: Install `gcloud` CLI
   ```bash
   # Install gcloud CLI
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL
   gcloud init
   ```

2. **Docker**: Install Docker Desktop or Docker Engine
   ```bash
   docker --version
   ```

3. **Google Cloud Project**: Create or select a project
   ```bash
   gcloud projects create YOUR_PROJECT_ID
   gcloud config set project YOUR_PROJECT_ID
   ```

4. **Enable APIs**: Enable required Google Cloud APIs
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

### Step-by-Step Deployment

#### Step 1: Build Docker Image

```bash
# Navigate to repository root
cd /path/to/Policy_AIX

# Build the Docker image
docker build -f backend/Dockerfile -t gcr.io/YOUR_PROJECT_ID/backend-app:latest .
```

**Build Time**: First build takes 10-15 minutes due to:
- Installing system dependencies
- Compiling native Node.js modules (sharp, etc.)
- Downloading MinerU and PyTorch (CPU-only, ~500MB)
- Compiling TypeScript

Subsequent builds are faster due to Docker layer caching.

#### Step 2: Push to Google Container Registry

```bash
# Configure Docker to use gcloud as credential helper
gcloud auth configure-docker

# Push the image
docker push gcr.io/YOUR_PROJECT_ID/backend-app:latest
```

#### Step 3: Deploy to Cloud Run

```bash
gcloud run deploy backend-app \
  --image gcr.io/YOUR_PROJECT_ID/backend-app:latest \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 5029 \
  --memory 6Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 10 \
  --min-instances 0 \
  --set-env-vars "NODE_ENV=production"
```

**Configuration Options**:
- `--memory 6Gi`: **Required** for MinerU (~500MB-1GB) and BGE-M3 embedding model (~2.27GB) with headroom
- `--cpu 2`: Recommended for concurrent processing
- `--timeout 3600`: 1 hour timeout for long-running operations (file extraction, RAG ingestion)
- `--max-instances 10`: Limit concurrent instances (adjust based on traffic)
- `--min-instances 0`: Scale to zero when idle (cost optimization)

**⚠️ Important**: Memory must be set to **6Gi** minimum due to:
- MinerU Python process: ~500MB-1GB
- BGE-M3 embedding model: ~2.27GB
- Node.js runtime: ~200MB
- System overhead: ~500MB-1GB
- **Total**: ~3.5GB-4.5GB minimum, with 6Gi providing safety margin

#### Step 4: Set Environment Variables

**Note**: Weaviate configuration (`WEAVIATE_API_KEY`, `WEAVIATE_HOST`, `WEAVIATE_HTTP_SCHEME`) is **hardcoded** in the startup scripts. You typically don't need to set these unless you want to override the defaults.

Set other required environment variables in Cloud Run:

```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "OPENAI_API_KEY=sk-..." \
  --set-env-vars "GOOGLE_SEARCH_API_KEY=..." \
  --set-env-vars "GOOGLE_SEARCH_API_CX_ID=..." \
  --set-env-vars "HF_TOKEN=hf_..." \
  --set-env-vars "WEAVIATE_API_KEY=YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw" \
  --set-env-vars "WEAVIATE_HOST=weaviate-872928420418.europe-west1.run.app" \
  --set-env-vars "WEAVIATE_HTTP_SCHEME=https"
```

**Optional**: Override Weaviate configuration if using a different instance:

```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --set-env-vars "WEAVIATE_HOST=your-custom-weaviate-host.run.app" \
  --set-env-vars "WEAVIATE_API_KEY=your-custom-key"
```

Or use Google Secret Manager (recommended for production):

```bash
# Create secrets
echo -n "your-openai-key" | gcloud secrets create openai-api-key --data-file=-
echo -n "your-weaviate-key" | gcloud secrets create weaviate-api-key --data-file=-

# Grant Cloud Run access to secrets
gcloud secrets add-iam-policy-binding openai-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Update Cloud Run service to use secrets
gcloud run services update backend-app \
  --region europe-west1 \
  --update-secrets "OPENAI_API_KEY=openai-api-key:latest,WEAVIATE_API_KEY=weaviate-api-key:latest"
```

#### Step 5: Verify Deployment

```bash
# Get the service URL
gcloud run services describe backend-app --region europe-west1 --format 'value(status.url)'

# Test health endpoint
curl https://YOUR-SERVICE-URL.run.app/health

# Expected response:
# {"status":"healthy","timestamp":"2026-01-18T...Z"}
```

### Continuous Deployment (CI/CD)

You can set up automated deployments using Cloud Build:

**File**: `cloudbuild.yaml` (create in repository root)

```yaml
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'backend/Dockerfile', '-t', 'gcr.io/$PROJECT_ID/backend-app:$SHORT_SHA', '.']
  
  # Push the container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/backend-app:$SHORT_SHA']
  
  # Deploy container image to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'backend-app'
      - '--image'
      - 'gcr.io/$PROJECT_ID/backend-app:$SHORT_SHA'
      - '--region'
      - 'europe-west1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--port'
      - '5029'

images:
  - 'gcr.io/$PROJECT_ID/backend-app:$SHORT_SHA'
```

Trigger deployment:

```bash
gcloud builds submit --config cloudbuild.yaml
```

---

## Environment Variables

### Required Environment Variables

Set these in Cloud Run Console or via `gcloud`:

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port (automatically set by Cloud Run) | `5029` | ✅ |
| `NODE_ENV` | Environment mode | `production` | ✅ |
| `OPENAI_API_KEY` | OpenAI API key for LLM | `sk-...` | ✅ |
| `WEAVIATE_API_KEY` | Weaviate vector database API key | `YmlueWRtK1J6Z1hNN1dvcV81SWg0dGxZUlltQmZRWFhWTWxtVHVkc3ZZWkUvZzljTXlhalFROWlZU3M4PV92MjAw` | ✅ |
| `WEAVIATE_HOST` | Weaviate instance host | `weaviate-872928420418.europe-west1.run.app` | ✅ |
| `WEAVIATE_HTTP_SCHEME` | Weaviate connection scheme | `https` | ✅ |
| `GOOGLE_SEARCH_API_KEY` | Google Custom Search API key | `...` | Optional |
| `GOOGLE_SEARCH_API_CX_ID` | Google Custom Search Engine ID | `...` | Optional |
| `HF_TOKEN` | Hugging Face token (for model downloads) | `hf_...` | Optional |

**Note**: `WEAVIATE_API_KEY`, `WEAVIATE_HOST`, and `WEAVIATE_HTTP_SCHEME` are **hardcoded** in startup scripts (`start-prod.sh`, `run-rag-ingestion.sh`, `run-serve-and-ingest.sh`) for production deployment. You can override them with environment variables if needed.

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISABLE_DB_INIT` | Skip database initialization | `false` |
| `DISABLE_FORCE_HTTPS` | Disable HTTPS redirect | `false` |
| `SESSION_SECRET` | Session encryption secret | `cloud-run-session-secret` |
| `PUPPETEER_EXECUTABLE_PATH` | Path to Chromium | `/usr/bin/chromium` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Skip Puppeteer Chromium download | `true` |

### Setting Environment Variables

**Via gcloud CLI**:
```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --update-env-vars "NODE_ENV=production,OPENAI_API_KEY=sk-..."
```

**Via Cloud Console**:
1. Go to Cloud Run → Select `backend-app` service
2. Click "Edit & Deploy New Revision"
3. Go to "Variables & Secrets" tab
4. Add environment variables
5. Click "Deploy"

**Via Secret Manager** (recommended for sensitive values):
```bash
# Create secret
echo -n "secret-value" | gcloud secrets create secret-name --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding secret-name \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Mount secret as environment variable
gcloud run services update backend-app \
  --region europe-west1 \
  --update-secrets "ENV_VAR_NAME=secret-name:latest"
```

---

## File Structure

### Cloud Run Container Structure

```
/app/
├── src/                          # TypeScript source (for reference)
├── ts-out/                       # Compiled JavaScript
│   ├── server.js                 # Main entry point (or ts-out/src/server.js)
│   └── src/                      # Compiled source files
│       ├── server.js
│       ├── customApp.js
│       ├── controllers/
│       └── ...
├── scripts/                      # Python scripts
│   ├── mineru_extract.py        # MinerU extraction wrapper
│   └── clean_markdown.py        # Markdown cleaning script
├── extraction_results/           # Created at startup (ephemeral)
│   └── *.md                      # Extracted markdown files
├── package.json                  # Node.js dependencies
├── start-prod.sh                 # Production startup script
├── .env                          # Environment variables (baked into image)
└── serviceAccountKey.json        # Google Service Account key
```

### Important Files

| File | Purpose | Location |
|------|---------|----------|
| `Dockerfile` | Container build definition | `backend/Dockerfile` |
| `start-prod.sh` | Production entrypoint | `backend/start-prod.sh` |
| `customApp.ts` | Cloud Run-compatible Express app | `backend/src/customApp.ts` |
| `server.ts` | Main server entry point | `backend/src/server.ts` |
| `chatController.ts` | API routes controller | `backend/src/controllers/chatController.ts` |
| `mineru_extract.py` | MinerU Python wrapper | `backend/scripts/mineru_extract.py` |

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Container Fails to Start - Port Not Listening

**Error**:
```
The user-provided container failed to start and listen on the port defined 
provided by the PORT=5029 environment variable within the allocated timeout.
```

**Causes**:
- Server binding to `localhost` instead of `0.0.0.0`
- Server not using `PORT` environment variable
- Application crashing before listening

**Solution**:
1. Verify `customApp.ts` binds to `0.0.0.0`:
   ```typescript
   this.httpServer.listen(this.port, '0.0.0.0', () => {
     // ...
   });
   ```
2. Verify `server.ts` uses `PORT` env var:
   ```typescript
   const port = parseInt(process.env.PORT || '5029', 10);
   ```
3. Check Cloud Run logs for startup errors:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app" --limit 50
   ```

#### Issue 2: "Cannot start server - compiled files missing"

**Error**:
```
❌ Cannot start server - compiled files missing!
```

**Cause**: TypeScript compilation failed or files weren't copied correctly.

**Solution**:
1. Check Docker build logs for TypeScript compilation errors
2. Verify `tsconfig.json` output directory matches Dockerfile
3. Ensure build context is repository root (not `backend/` directory)

#### Issue 3: MinerU Not Found

**Error**:
```
Extraction method: TEXT (instead of MINERU)
```

**Cause**: Python virtual environment not in PATH or MinerU not installed.

**Solution**:
1. Verify PATH includes venv:
   ```dockerfile
   ENV PATH="/opt/mineru-venv/bin:/root/.venv/bin:${PATH}"
   ```
2. Check if MinerU is installed:
   ```bash
   docker run --rm gcr.io/PROJECT_ID/backend-app:latest python3 -c "import mineru; print('OK')"
   ```

#### Issue 4: Directory Not Found (extraction_results)

**Error**:
```
❌ Extraction results directory does not exist: /app/extraction_results
```

**Cause**: Directory not created on startup (stateless container).

**Solution**: Verify `server.ts` creates directory:
```typescript
await mkdir(extractionResultsDir, { recursive: true });
```

#### Issue 5: Weaviate Connection Refused

**Error**:
```
Error: connect ECONNREFUSED 127.0.0.1:8080
TypeError: fetch failed [cause]: Error: connect ECONNREFUSED 127.0.0.1:8080
```

**Cause**: Application is trying to connect to localhost instead of external Weaviate host.

**Solution**:
1. Verify `WEAVIATE_HOST` is set in startup scripts (`start-prod.sh`, `run-rag-ingestion.sh`)
2. Check that `WEAVIATE_HTTP_SCHEME` is set to `https` (not `http`)
3. Ensure Weaviate service is accessible:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://weaviate-872928420418.europe-west1.run.app/v1/meta
   ```
4. Review Cloud Run logs for Weaviate connection attempts:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app AND jsonPayload.message=~\"Weaviate\"" --limit 20
   ```

#### Issue 6: Memory Limit Exceeded

**Error**:
```
Memory limit of 6Gi exceeded
Container terminated due to memory limit
```

**Cause**: 
- Delay between MinerU and RAG ingestion too short
- Concurrent document processing
- Memory leak

**Solution**:
1. Verify 10-second delay is set in `chatController.ts`
2. Check for concurrent requests (limit if necessary)
3. Increase memory limit:
   ```bash
   gcloud run services update backend-app --region europe-west1 --memory 8Gi
   ```
4. Review memory usage patterns in Cloud Run metrics

#### Issue 7: Weaviate Schema Creation Failed

**Error**:
```
⚠️  Warning: Failed to create RagDocument schema (may already exist or Weaviate unavailable)
```

**Causes**:
- Weaviate service unavailable
- API key incorrect
- Network connectivity issue

**Solution**:
1. Verify Weaviate is accessible:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://weaviate-872928420418.europe-west1.run.app/v1/meta
   ```
2. Check API key matches in startup scripts
3. Verify network connectivity from Cloud Run to Weaviate
4. **Note**: This is often not a critical error - schema creation is idempotent, and if schemas already exist, the application will work correctly.

#### Issue 8: CORS Errors

**Error**: Frontend gets CORS errors when calling backend.

**Solution**:
1. Verify OPTIONS handler is first middleware
2. Check CORS middleware is configured correctly
3. Verify Cloud Run allows unauthenticated requests (if needed)

#### Issue 9: Build Fails - Native Module Compilation

**Error**: `sharp` or other native modules fail to compile.

**Solution**: Ensure build tools are installed:
```dockerfile
RUN apt-get install -y build-essential python3-dev libvips-dev
```

### Debugging Commands

**View Cloud Run Logs**:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app" --limit 100 --format json
```

**Test Locally with Docker**:
```bash
docker run -p 5029:5029 \
  -e PORT=5029 \
  -e OPENAI_API_KEY=your-key \
  gcr.io/PROJECT_ID/backend-app:latest
```

**Check Container Logs**:
```bash
gcloud run services logs read backend-app --region europe-west1 --limit 50
```

**Inspect Container**:
```bash
docker run -it --entrypoint /bin/bash gcr.io/PROJECT_ID/backend-app:latest
```

**Verify Server File**:
```bash
docker run --rm gcr.io/PROJECT_ID/backend-app:latest ls -la ts-out/
docker run --rm gcr.io/PROJECT_ID/backend-app:latest find ts-out -name "server.js"
```

---

## Key Differences: Local vs Cloud Run

### Local Development

| Aspect | Local | Cloud Run |
|--------|-------|-----------|
| Port | Hardcoded `5029` | Environment variable `PORT` |
| Host Binding | `localhost` or `127.0.0.1` | `0.0.0.0` (all interfaces) |
| Sessions | Can use Redis | Memory-based (per instance) |
| Storage | Persistent filesystem | Ephemeral (resets on restart) |
| Database | Local Postgres/Redis | External services (Firestore, etc.) |
| Scaling | Single instance | Auto-scales 0 to N instances |

### Architecture Differences

**Local**:
- Uses `docker-compose` for Postgres, Redis
- Redis-backed sessions
- Persistent `extraction_results/` directory
- Can use `nodemon` for development

**Cloud Run**:
- No local databases (uses external services)
- Memory-based sessions (not shared across instances)
- Ephemeral filesystem (must create directories on startup)
- Direct `node` execution (no `nodemon`)

---

## Performance Considerations

### Memory Requirements

**Minimum Required**: **6Gi** (recommended: 6Gi-8Gi)

**Memory Breakdown**:

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| MinerU (Python process) | ~500MB-1GB | PDF extraction, layout detection, OCR |
| BGE-M3 Embedding Model | ~2.27GB | Loaded by @xenova/transformers for RAG ingestion |
| Node.js Runtime | ~200MB | Base application runtime |
| System Overhead | ~500MB-1GB | OS, libraries, buffers |
| **Total Minimum** | **~3.5GB-4.5GB** | **6Gi provides safety margin** |

**⚠️ Critical Memory Management**:

To prevent memory spikes, the application implements a **10-second delay** between MinerU extraction completion and RAG ingestion start. This allows:

1. MinerU Python process to fully exit and release memory (~500MB-1GB)
2. Python garbage collection to complete
3. System to free up memory before loading BGE-M3 model (~2.27GB)

**Code Location**: `backend/src/controllers/chatController.ts`

```typescript
// Trigger cleaning and RAG ingestion script AFTER extraction completes successfully
// Wait a moment to ensure MinerU's Python process fully exits and releases memory (~500MB-1GB)
// before loading BGE-M3 embedding model (~2.27GB) to avoid exceeding memory limits
const scriptPath = join(process.cwd(), 'run-serve-and-ingest.sh');
const delaySeconds = 10; // 10 seconds delay to allow memory cleanup (enough for Python process to exit)
console.log(`🔄 Will trigger post-extraction script in ${delaySeconds} seconds: ${scriptPath}`);
console.log(`   (Waiting to allow MinerU Python process to exit and release memory)`);

// Wait 10 seconds to ensure MinerU process exits and memory is released before RAG ingestion
// This prevents memory spike when BGE-M3 model loads while MinerU models are still in memory
setTimeout(() => {
  // Start RAG ingestion script...
}, delaySeconds * 1000);
```

**Update Memory**:
```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --memory 6Gi  # Minimum required
```

### CPU Configuration

- **Recommended**: 2 CPU minimum for concurrent processing
- **File Extraction**: CPU-intensive (MinerU processing)
- **Embedding Generation**: CPU-intensive (model inference)

**Update CPU**:
```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --cpu 4  # Increase for better performance
```

### Timeout Configuration

- **Default**: 300 seconds (5 minutes)
- **Required**: 3600 seconds (1 hour) for long operations
  - File extraction can take 5-10 minutes
  - RAG ingestion can take 10-30 minutes

**Update Timeout**:
```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --timeout 3600
```

### Scaling Configuration

```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --min-instances 0 \    # Scale to zero when idle
  --max-instances 10 \   # Limit max concurrent instances
  --concurrency 80       # Requests per instance
```

---

## Memory Management and Optimization

### Memory Spike Prevention

The application processes large PDFs and generates embeddings, requiring careful memory management to avoid exceeding Cloud Run's memory limits.

#### Problem

When processing a document:
1. **MinerU Extraction** loads Python models (~500MB-1GB)
2. **RAG Ingestion** loads BGE-M3 embedding model (~2.27GB)
3. If both load simultaneously, total memory can exceed 4GB

#### Solution: Staggered Memory Usage

The application implements a **10-second delay** between MinerU completion and RAG ingestion:

```
Document Upload
    │
    ▼
MinerU Extraction (Python)
    ├─► Loads models: ~500MB-1GB
    ├─► Processes PDF
    └─► Generates markdown
    │
    ▼ (10 second delay - Python process exits, memory released)
    │
    ▼
RAG Ingestion (Node.js)
    ├─► Cleans markdown
    ├─► Loads BGE-M3 model: ~2.27GB
    ├─► Generates embeddings
    └─► Stores in Weaviate
```

**Implementation**:

**File**: `backend/src/controllers/chatController.ts`

```typescript
// After MinerU extraction completes successfully
const delaySeconds = 10; // 10 seconds delay to allow memory cleanup

setTimeout(() => {
  console.log(`🚀 Starting post-extraction script: ${scriptPath}`);
  
  // Spawn RAG ingestion script
  const scriptProcess = spawn('bash', [scriptPath, markdownFileName], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MEMORY_ID: memoryId,
      USER_ID: userId,
      MARKDOWN_FILENAME: markdownFileName
    }
  });
  
  // Log output and monitor completion
  scriptProcess.stdout.on('data', (data) => {
    console.log(`[Post-extraction script] ${data.toString().trim()}`);
  });
  
  scriptProcess.unref(); // Allow Node.js to exit even if script is still running
}, delaySeconds * 1000);
```

#### Why 10 Seconds?

- **MinerU Python Process Exit**: ~2-3 seconds
- **Python Garbage Collection**: ~2-3 seconds
- **System Memory Reclamation**: ~2-4 seconds
- **Safety Margin**: ~1-2 seconds

**Total**: 10 seconds provides sufficient time for memory cleanup before loading the next memory-intensive component.

### Memory Monitoring

Monitor memory usage in Cloud Run logs:

```bash
# View recent logs with memory-related messages
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app AND jsonPayload.message=~\"memory\"" --limit 50

# View container memory metrics
gcloud run services describe backend-app --region europe-west1 --format="value(status.conditions)"
```

### Memory Optimization Tips

1. **Set Memory Limit Correctly**: Always use **6Gi** minimum
   ```bash
   gcloud run services update backend-app --region europe-west1 --memory 6Gi
   ```

2. **Monitor Memory Usage**: Check Cloud Run metrics dashboard for memory utilization

3. **Adjust Delay if Needed**: If experiencing memory errors, increase delay in `chatController.ts`:
   ```typescript
   const delaySeconds = 15; // Increase if memory errors persist
   ```

4. **Scale Vertically First**: If memory errors persist, increase memory before scaling horizontally:
   ```bash
   gcloud run services update backend-app --region europe-west1 --memory 8Gi
   ```

5. **Use Memory Efficient Models**: The BGE-M3 model is already optimized for memory usage

### Memory Error Troubleshooting

**Error**: `Memory limit of 6Gi exceeded`

**Causes**:
- Delay too short (Python process hasn't exited)
- Multiple concurrent requests loading models simultaneously
- Memory leak in long-running process

**Solutions**:
1. Verify delay is set to 10 seconds in `chatController.ts`
2. Check for concurrent document processing (limit concurrent uploads)
3. Review logs for memory usage patterns
4. Increase memory limit if necessary:
   ```bash
   gcloud run services update backend-app --region europe-west1 --memory 8Gi
   ```

---

## Monitoring and Logging

### Cloud Run Logs

View logs in Cloud Console:
1. Go to Cloud Run → Select `backend-app`
2. Click "Logs" tab
3. Filter by severity, search terms, etc.

Via CLI:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app" --limit 50
```

### Key Metrics to Monitor

- **Request Count**: Number of requests per second
- **Request Latency**: P50, P95, P99 latencies
- **Error Rate**: 4xx/5xx errors
- **Instance Count**: Active instances
- **CPU Utilization**: Per-instance CPU usage
- **Memory Utilization**: Per-instance memory usage

### Alerts Setup

```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=300s
```

---

## Cost Optimization

### Strategies

1. **Scale to Zero**: `--min-instances 0` (default)
   - No cost when no traffic
   - Cold starts on first request (~5-10 seconds)

2. **Keep Warm**: `--min-instances 1` (if cold starts are unacceptable)
   - Costs ~$0.40/day per instance (2Gi, 2 CPU, europe-west1)

3. **Resource Sizing**: Right-size memory/CPU
   - Monitor actual usage
   - Reduce if consistently underutilized

4. **Request Timeout**: Set appropriate timeouts
   - Shorter timeouts for simple requests
   - Longer timeouts for batch operations

### Cost Estimation

**Example**: 2Gi memory, 2 CPU, europe-west1

- **Requests**: $0.40 per million requests
- **CPU/Memory**: $0.00002400 per vCPU-second, $0.00000250 per GiB-second
- **Estimated**: ~$20-50/month for moderate traffic

**Calculate Costs**:
```bash
# Use Google Cloud Pricing Calculator
# https://cloud.google.com/products/calculator
```

---

## References

### Documentation

- **Google Cloud Run**: https://cloud.google.com/run/docs
- **Cloud Run Troubleshooting**: https://cloud.google.com/run/docs/troubleshooting
- **Docker Best Practices**: https://docs.docker.com/develop/dev-best-practices/
- **Node.js on Cloud Run**: https://cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-nodejs-service

### Related Files

- `backend/Dockerfile` - Container definition
- `backend/start-prod.sh` - Production entrypoint
- `backend/src/customApp.ts` - Cloud Run-compatible Express app
- `backend/src/server.ts` - Main server entry point
- `docs/BE_FILE_UPLOAD_MINERU_RAG_PIPELINE.md` - File processing pipeline
- `docs/GOOGLE_CLOUD_RUN_CORS_SOLUTION.md` - CORS configuration

### Key Concepts

- **Container Port**: Must bind to `0.0.0.0`, use `PORT` env var
- **Stateless**: No persistent storage, create directories on startup
- **Health Checks**: Cloud Run checks TCP connection on startup
- **CORS**: Configure for cross-origin requests from frontend
- **Sessions**: Use memory-based (not Redis) for stateless deployment

---

## Quick Reference

### Build and Deploy Commands

```bash
# 1. Build Docker image
docker build -f backend/Dockerfile -t gcr.io/PROJECT_ID/backend-app:latest .

# 2. Push to Container Registry
docker push gcr.io/PROJECT_ID/backend-app:latest

# 3. Deploy to Cloud Run
gcloud run deploy backend-app \
  --image gcr.io/PROJECT_ID/backend-app:latest \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 5029 \
  --memory 6Gi \
  --cpu 2 \
  --timeout 3600
```

**⚠️ Important**: Memory must be **6Gi** minimum due to MinerU (~500MB-1GB) and BGE-M3 model (~2.27GB) requirements.

### Environment Variables Setup

```bash
gcloud run services update backend-app \
  --region europe-west1 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "OPENAI_API_KEY=sk-..."

# Note: Weaviate config is hardcoded in scripts, but can be overridden:
# --set-env-vars "WEAVIATE_API_KEY=..." \
# --set-env-vars "WEAVIATE_HOST=weaviate-872928420418.europe-west1.run.app" \
# --set-env-vars "WEAVIATE_HTTP_SCHEME=https"
```

### View Logs

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=backend-app" --limit 50
```

### Get Service URL

```bash
gcloud run services describe backend-app --region europe-west1 --format 'value(status.url)'
```

---

## Summary

This guide covers:

1. ✅ **Architecture**: How the application works in Cloud Run with external services
2. ✅ **Docker Configuration**: Multi-stage build with Python, Node.js, and dependencies
3. ✅ **Weaviate Configuration**: External vector database setup and schema management
4. ✅ **Code Changes**: Cloud Run compatibility (0.0.0.0 binding, PORT env var)
5. ✅ **Deployment Process**: Step-by-step deployment instructions
6. ✅ **Environment Variables**: Required and optional configuration
7. ✅ **Memory Management**: 10-second delay strategy and 6Gi memory requirement
8. ✅ **Troubleshooting**: Common issues and solutions
9. ✅ **Performance**: Resource sizing and optimization
10. ✅ **Monitoring**: Logging and metrics

The backend is now fully configured for Google Cloud Run deployment with:
- ✅ Automatic scaling
- ✅ Health checks
- ✅ CORS support
- ✅ MinerU PDF extraction (Python-based)
- ✅ RAG ingestion pipeline with BGE-M3 embeddings
- ✅ External Weaviate vector database integration
- ✅ Schema auto-creation on startup
- ✅ Memory spike prevention (10-second delay)
- ✅ WebSocket support
- ✅ Stateless architecture
