# Backend Python Migration — Frozen Contract (Phase 0)

This is the **acceptance test** for replacing the Node/TS backend with Python.
The frontend will NOT change during the migration, so the Python service must
reproduce every item below **byte-for-byte**: same routes, same status codes,
same JSON shapes, same WebSocket handshake and event types.

Source of truth at capture time:
- Routes / HTTP: `backend/src/controllers/chatController.ts`
- WS server / handshake: `backend/src/customApp.ts`
- WS event emit: `chatController.sendWsEvent` + `@policysynth/api` `PsBaseChatBot`
  (via `skillsFirstChatBotFirestore.ts`)
- Frontend consumer: `frontend/services/research-api.js` +
  `frontend/components/research/research-chatbot.jsx`

Base path: `process.env.API_BASE_PATH || "/api/policy_research"`.
Frontend base URL: `NEXT_PUBLIC_RESEARCH_API_URL || "/api"`.
WS URL: `NEXT_PUBLIC_RESEARCH_WS_URL || "ws://localhost:5029/ws"`.
Default port: `PORT || 5029` (Cloud Run sets `PORT`). Bind `0.0.0.0`.

---

## 1. HTTP routes the Python service MUST serve

(all prefixed with the base path `/api/policy_research`)

- [ ] `PUT  /`  → `skillsFirstChat` — starts a chat turn. Body:
      `{ wsClientId, chatLog[], memoryId, userId, silentMode?, numberOfSelectQueries?, percentOfTopQueriesToSearch?, percentOfTopResultsToScan?, uploadedDocuments? }`.
      Returns the saved `chatLog[]` (200) or `200`/`500`. **The actual answer
      streams over the WebSocket, not in this response.**
- [ ] `GET  /conversations?userId=...` → `{ conversations: [...] }`
- [ ] `POST /conversations/:memoryId/metadata` — body `{ conversationTitle, conversationSummary }` → `{ success: true }`
- [ ] `DELETE /conversations/:memoryId?userId=...` → `{ success: true }`
      (also fires OpenAI vector-store + file cleanup, best-effort)
- [ ] `POST /ingest-geojson` — body `{ geojsonContent, fileName, memoryId, userId }`
      → `202 { success, fileId, featureCount, message, status:'processing' }`
      then background work + WS events
- [ ] `POST /ingest-json` — body `{ jsonContent, fileName, memoryId, userId }`
      → `202 { success, fileId, recordCount, message, status:'processing' }`
- [ ] `POST /ingest-pdf` — multipart `file` (+ `memoryId`,`userId`) →
      `202 { success, fileId, status:'processing' }`; `413` on >50MB; `400` on reject
- [ ] `GET  /catastro-geojson` → streams `mcp-service/data/Catastro.geojson`
- [ ] `POST /conversations/:memoryId/documents` — body `{ document, userId }` → `{ success, document }`
- [ ] `PUT  /conversations/:memoryId/documents/:documentId` — body `{ status, ...meta, userId }` → `{ success: true }`
- [ ] `DELETE /conversations/:memoryId/documents/:documentId?userId=...` → `{ success: true }`
- [ ] `GET  /conversations/:memoryId/documents` → `{ documents: [...] }`
- [ ] `GET  /conversations/:memoryId/documents/:documentId/download?name=...` → file blob (Content-Disposition attachment)
- [ ] `GET  /:memoryId` → `{ chatLog[], totalCosts, uploadedDocuments? }` or `404`
      **(this is the stall-recovery path the frontend watchdog reads)**
- [ ] `GET  /health` → `200 { status:'healthy', timestamp }` (Cloud Run probe; must be instant)

### Frontend-referenced routes that the backend does NOT currently serve
These are **dead frontend paths** today (would 404). Do not implement unless
the frontend is also updated. Listed so the rewrite doesn't "helpfully" add them.
- `POST /policy_research/extract` (used by `extractFile()` — superseded by `/ingest-pdf`)
- `GET  /policy_research/extract/result/:id` (used by `getExtractionResult()`)

---

## 2. WebSocket contract

- [ ] WS path: `/ws` on the same HTTP server.
- [ ] On connect, server sends `{ "clientId": "<uuid>" }` as the FIRST frame.
      Frontend stores this and resolves its connect promise on it.
- [ ] Inbound from client: messages arrive as `{ ...payload, clientId }`.
      (Current Node server ignores inbound WS content; the chat turn is started
      via the `PUT /` HTTP call carrying `wsClientId`. Preserve that split.)
- [ ] Outbound base envelope used by ingestion events:
      `{ sender: 'bot', type: <string>, data: <object> }`.
- [ ] Server must broadcast to the socket whose id matches `wsClientId`.
- [ ] Normal close codes `1000`/`1001` must NOT trigger frontend reconnect.

### 2a. Event `type`s the frontend CONSUMES
(`research-chatbot.jsx` switch + `research-api.js` normalizer — both raw and
normalized spellings must keep working; the normalizer maps camelCase→snake_case)

Chat lifecycle (emitted today by the PsBaseChatBot framework — must be reproduced):
- [ ] `agentStart` / `agent_start`
- [ ] `agentUpdate` / `agent_update`
- [ ] `agentCompleted` / `agent_completed` (with `data.lastAgent === true` on final)
- [ ] `streamResponse` / `stream_response` / `stream` (token chunk; carries `content`)
- [ ] `chatResponse` / `chat_response` (full message; carries `content`)
- [ ] `streamEnd` / `stream_end` / `end` / `complete` / `finished`
- [ ] `error` (carries `message` or `error`)
- [ ] `memoryIdCreated` (carries the new `memoryId` for a fresh conversation)
- [ ] `liveLlmCosts` and `costUpdate` / `cost_update`

Tool-activity rows (emitted by `skillsFirstChatBotFirestore.notifyToolStart`):
- [ ] `web_search_start`
- [ ] `code_interpreter_start`
- [ ] `file_search_start`

Domain/visual events (emitted by the chatbot during geo answers):
- [ ] `map_concessions`  (renders map layer)
- [ ] `analysis_panel`   (renders analysis side panel)

Ingestion events (emitted by `chatController.sendWsEvent`):
- [ ] `extractionProgress`  `data: { fileId, phase:'extracting'|'indexing', fileName? }`
- [ ] `extractionCompleted` `data: { fileId, phase:'extracted' }`
- [ ] `extractionFailed`    `data: { fileId, documentName, error }`
- [ ] `ragIngestionCompleted` `data: { fileId, documentName, s3Key?, s3Bucket?, message, featureCount?|summaryCount? }`

Connection pseudo-events (synthesized client-side, no backend action needed):
`connected`, `disconnected`.

---

## 3. External systems / data stores (shared — NO migration of data)

- [ ] **Firestore** (via `firebase-admin`): conversation memory, `chatLog`,
      `uploadedDocuments`, geojson summaries, cost totals. Python uses the SAME
      project + `serviceAccountKey.json`. Source of truth — must read/write the
      identical document shape (`FirestoreMemoryService`).
- [ ] **OpenAI** (Responses API): streaming, `file_search`, `code_interpreter`,
      `web_search_preview`, Files API (`input_file`/`input_image`), vector stores.
      Python `openai` SDK supports all of these.
- [ ] **AWS S3** (`@aws-sdk/client-s3` → `boto3`): original uploaded files for download.
- [ ] **MCP geo service** (`mcp-service/`, already Python): geocode / spatial /
      polygon tools. Folds directly into the Python backend.

### Library swaps
- `exceljs` → `openpyxl` / `pandas` (spreadsheet → Markdown, deterministic chunking)
- `pdf-parse` / `pdfjs-dist` → `pypdf` / `pdfplumber` (only the local-parse fallback;
   primary PDF path is OpenAI vector store)
- `multer` → FastAPI `UploadFile`
- `ws` → FastAPI `WebSocket`
- `express` + `BaseController` → FastAPI routers

### The one true rewrite (critical path)
`PsBaseChatBot` (`@policysynth/api`) provides, for free, what Python must
re-implement by hand:
- [ ] the streaming chat loop + token emit over WS
- [ ] `saveMemory()` to Firestore
- [ ] `getFullCostOfMemory()` cost accounting
- [ ] the `sendToClient` / `sendAgentStart|Update|Completed` event helpers
Your own logic in `skillsFirstChatBotFirestore.ts` sits on top and is ported as-is.

---

## 4. Deployment contract (Cloud Run)
- [ ] Single container, reads `PORT`, binds `0.0.0.0`, `/health` answers instantly.
- [ ] Same env vars: `OPENAI_API_KEY`/`AI_MODEL_API_KEY`, `AWS_*`, Firebase creds,
      `API_BASE_PATH`, `SESSION_SECRET`, `MULTIMODAL_MODEL` (defaults `gpt-4o`).
      NOTE: `MULTIMODAL_INFERENCE` is dead — never read in code; the multimodal
      pipeline is the only chat path now (`skillsFirstChatBotFirestore.ts`
      calls `runMultimodalConversation` unconditionally). Do NOT reintroduce a
      flag or a legacy text-blob RAG path; those methods were already deleted.
- [ ] Consider `min-instances=1` if Python cold-start latency is noticeable.

---

## How to use this file
1. Record a golden transcript: run one real GeoJSON chat against the Node app and
   capture the full ordered list of WS frames + the `PUT /` and `GET /:memoryId`
   payloads. Save as fixtures.
2. Build the Python service route-by-route, checking boxes above.
3. A route/event is "done" only when its Python output matches the Node golden
   fixture for the same input.
