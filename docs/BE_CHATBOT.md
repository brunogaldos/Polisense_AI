# BE_CHATBOT — Chatbot Architecture

Four files make up the chatbot stack:

| File | Role |
|---|---|
| `base_chat_bot.py` | WebSocket helpers, memory CRUD, cost tracking |
| `router.py` | LLM intent classifier |
| `document_context_service.py` | Builds the multimodal file context for a conversation |
| `skills_first_chat_bot.py` | Main turn orchestrator — inherits base, calls router, dispatches to handlers |

---

## Class hierarchy

```
PsBaseChatBot  (base_chat_bot.py)
    └── SkillsFirstChatBot  (skills_first_chat_bot.py)
```

---

## `PsBaseChatBot`

Constructed once per HTTP chat request. Holds:

```python
self.ws_client_id    # UUID from the browser's WebSocket connection
self.ws_clients      # module-level registry dict[str, WebSocket]
self.ws_client_socket # cached socket handle (re-resolved on miss)
self.memory          # dict — Firestore document shape
self.memory_id       # conversation UUID
self.user_id         # Firebase Auth UID
self.openai_client   # AsyncOpenAI (lazy, created once per process)
self.persist_memory  # False in base, True in SkillsFirstChatBot
self.silent_mode     # True → suppress all WS sends (used by ingestion tasks)
```

### WebSocket send helpers

```python
await send_to_client(sender, message, type="stream")
# → {"sender": "bot", "type": "stream", "message": "..."}

await send_agent_start(name)
# → {"sender": "bot", "type": "agentStart", "data": {"name": ...}}

await send_agent_completed(name, last_agent, error)
# → {"sender": "bot", "type": "agentCompleted", "data": {...}}

await send_agent_update(message)
# → {"sender": "bot", "type": "agentUpdated", "message": "..."}
```

The WebSocket handle is re-resolved from `ws_clients` on every send so a client reconnect mid-turn doesn't break streaming.

### Memory lifecycle

```
setup_memory()
    if memory_id → load from Firestore → self.memory
    else → new UUID → empty memory → send memoryIdCreated over WS

save_memory()
    → FirestoreMemoryService.save_memory(memory_id, memory, user_id)

save_memory_if_needed()
    → only saves when persist_memory=True (set by SkillsFirstChatBot)
```

### Cost tracking

Word-count based estimate (mirrors the Node `addToExternalSolutionsMemoryCosts`):

```python
estimate = word_count * 1.3   # words-to-tokens magic constant
in_cost  = estimate * 0.01 / 1000   # $0.01 per 1k input tokens
out_cost = estimate * 0.03 / 1000   # $0.03 per 1k output tokens
```

Accumulated per stage in `memory["stages"]["chatbot-conversation"]`.

---

## `PsRagRouter`

A single OpenAI `chat.completions.create` call that classifies every user message.

### Intent options

| Intent | When used |
|---|---|
| `rag` | Focused question about uploaded documents (default) |
| `multi_query` | Complex, multi-part document question needing broad coverage |
| `conversational` | Greeting, follow-up, general knowledge, math, coding |
| `geospatial` | Explicit map visualization request (show/draw/render on map) |

### Input / Output

```python
routing_data = await router.get_routing_data(
    user_question,   # latest user message
    data_layout,     # categories + aboutProject from dataLayout.json
    chat_history,    # JSON-serialized prior turns (for context carry-over)
)
# Returns:
{
  "intent": "rag",
  "primaryCategory": "Environmental Policy",
  "rewrittenUserQuestionVectorDatabaseSearch": "environmental policy carbon emissions targets"
}
```

The rewritten question is used by the multimodal pipeline for `file_search`. If blank, the original message is used.

Model: `ROUTER_MODEL` env var (default `gpt-4o-mini`). Temperature 0. JSON mode.

---

## `DocumentContextService`

Called at the start of every multimodal turn. Fetches from Firestore only — no OpenAI calls.

```python
context = await DocumentContextService.build_for_conversation(memory_id)
# Returns:
{
  "vectorStoreId": "vs_abc123",      # feeds file_search tool
  "attachableFileIds": ["file-1"],   # attached as input_file / input_image
  "imageFileIds": ["file-1"],        # subset that are images → input_image
  "documentNames": ["report.pdf"],   # shown in system prompt
  "hasReadyDocuments": True,
}
```

### Attachment selection rules

Only documents with `extractionStatus == "rag_ready"` are candidates.

File ID priority (per document):
1. `attachableFileId` (explicit original bytes) — authoritative
2. `openaiFileId` — only for PDFs, only when the vector-store file IS the original bytes (direct ingestion path)
3. Images always require `attachableFileId` (their `openaiFileId` points to an OCR'd `.md`)

Budget limits (configurable via env):
- `MULTIMODAL_MAX_ATTACHED_FILES` = 4
- `MULTIMODAL_MAX_ATTACHED_BYTES` = 12 MB

Files are sorted newest-first; oversized files are skipped unless they're the only file. Remaining files still reach the model via `file_search`.

---

## `SkillsFirstChatBot` — turn entry point

```python
async def skills_first_conversation(chat_log, data_layout):
```

### Dispatch logic

```
skills_first_conversation(chat_log, data_layout)
    │
    ├─ load memory if not pre-loaded
    ├─ set_chat_log(chat_log) → Firestore save
    │
    ├─ router.get_routing_data(user_last_message, ...)
    │
    ├─ OVERRIDE: deep_analysis regex match?
    │       └─► handle_geospatial_query()
    │
    ├─ OVERRIDE: draw_polygon regex match?
    │       └─► handle_draw_polygon_from_document()
    │
    ├─ OVERRIDE: overlap trigger (traslap / overlap / intersect)?
    │       └─► handle_overlap_analysis()
    │
    ├─ intent == "geospatial"?
    │       └─► handle_geospatial_query()
    │
    └─ rag / multi_query / conversational
            └─► run_multimodal_conversation()
```

The three regex overrides take precedence over the router because they are structural cues in the user message that are more reliable than LLM classification for specific actions.

---

## `run_multimodal_conversation` — RAG pipeline

```
DocumentContextService.build_for_conversation(memory_id)
    │
    ├─ Build system prompt (file_search / input_file hints)
    ├─ Build history messages (last 12 turns, 6000 chars/msg truncation)
    ├─ Build user content (input_text + input_file + input_image blocks)
    │
    └─ openai_client.responses.create(
           model = MULTIMODAL_MODEL (default gpt-4o)
           input = [system, ...history, user]
           tools = [web_search_preview, file_search?, code_interpreter]
           stream = True
           max_output_tokens = 4000
           temperature = 0.0
       )
           │
           ├─ response.web_search_call.* → WS: web_search_start
           ├─ response.file_search_call.* → WS: file_search_start
           ├─ response.code_interpreter_call.* → WS: code_interpreter_start
           ├─ response.output_text.delta → WS: stream (token)
           └─ response.output_text.annotation.added → collect citations
               │
               └─ After stream: append citation footer → WS: end
                  → chatLog.append(full_text) → save_memory()
```

`file_search` is only added to the tools list when `vectorStoreId` is non-null. `web_search_preview` is always included.

### History truncation

```python
HISTORY_TURN_LIMIT   = 12    # max turns carried into context
HISTORY_PER_MESSAGE_MAX = 6000  # chars per message
# Truncation: keep 60% head + 30% tail, drop middle
```

---

## Geo handlers

Three methods handle map-related turns, all eventually calling the MCP service via `GeoMCPClient`.

### `handle_draw_polygon_from_document`

1. Look for a UTM coordinate table in the user's own message
2. Fall back to the last 10 bot messages in the chat log
3. Call `render_polygons` MCP tool with `utm_vertices`
4. Push `map_concessions` WS event → Mapbox renders the polygon

### `handle_overlap_analysis`

1. Extract centroid from the chat log (looks for `Centroid:` / `Centroide:` or UTM table)
2. Convert to WGS84 lat/lon using Snyder 1987 UTM inverse formula
3. Call `render_polygons` MCP tool with `easting`/`northing` (GEOCATMIN spatial query)
4. Format result as human-readable overlap report → stream over WS

### `handle_geospatial_query`

Full LLM-in-the-loop geo flow:

```
1. Load GeoJSON summaries from Firestore (geo context)
2. List available MCP tools (from mcp.list_tools())
3. openai_client.chat.completions.create(
       tools = MCP tools as OpenAI function-calling schema
       messages = [system with geo context, chat history, user message]
   )
4. Parse tool_call from response
5. geo_client.call_tool(tool_name, tool_args)
6. Send result to map (map_concessions WS event) or stream panels
```

### `GeoMCPClient` — stdio transport

```python
client = GeoMCPClient()
await client.connect()           # spawns mcp-service/server.py as subprocess
result = await client.call_tool("render_polygons", {...})
await client.disconnect()        # closes subprocess
```

Python interpreter resolution:
1. `mcp-service/venv/bin/python` (local venv in the service dir)
2. `$PYTHON_EXECUTABLE` env var
3. `python3` (system fallback)

The subprocess is spawned per geo turn — no long-lived process. `connect()` and `disconnect()` must run in the same asyncio task (anyio scope restriction).

---

## Language detection

```python
def _detect_user_language(text: str) -> str:
    # Checks for Spanish signals: articles, geo terms, accented chars, ¿¡
    return "es" if any(s in source for s in spanish_signals) else "en"
```

Used to choose between Spanish and English user-facing error/status messages in the geo handlers. Chat responses are detected and answered by the LLM itself.
