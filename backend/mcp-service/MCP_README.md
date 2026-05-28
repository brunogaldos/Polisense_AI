# Geodata MCP Service

Technical reference for the Polisense geospatial pipeline.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Component Reference](#component-reference)
   - [MCP Server — server.py](#mcp-server--serverpy)
   - [MCP Client — mcpGeoClient.ts](#mcp-client--mcpgeoclientts)
   - [Intent Router — router.ts](#intent-router--routerts)
   - [Chatbot Orchestration — skillsFirstChatBotFirestore.ts](#chatbot-orchestration--skillsfirstchatbotfirestorets)
   - [Frontend — research-chatbot.jsx](#frontend--research-chatbotjsx)
   - [Map Layer Rendering — explore-map/component.jsx](#map-layer-rendering--explore-mapcomponentjsx)
5. [Special Trigger Modes](#special-trigger-modes)
   - [DRAW_POLYGON_TRIGGER](#draw_polygon_trigger)
   - [OVERLAP_TRIGGER](#overlap_trigger)
   - [Catastro Minero @ Token](#catastro-minero--token)
6. [MCP Protocol — How it Works](#mcp-protocol--how-it-works)
7. [End-to-End Request Walkthrough](#end-to-end-request-walkthrough)
8. [Tool Reference](#tool-reference)
9. [Data — Catastro.geojson](#data--catastrogenejson)
10. [Environment Variables](#environment-variables)
11. [Dependencies](#dependencies)
12. [Setup](#setup)

---

## Overview

The Geodata MCP Service exposes geospatial tools to the Polisense chatbot through the
**Model Context Protocol (MCP)** over stdio. When a user sends a geospatial question in
the chat panel the backend:

1. Detects a `geospatial` intent via the LLM router (or fires a special trigger mode)
2. Spawns the Python MCP server as a child process
3. Fetches the tool definitions from the server and passes them to the LLM
4. Executes whichever tool the LLM selects via JSON-RPC over stdio
5. Sends the GeoJSON result to the frontend as a WebSocket `map_concessions` message
6. The Mapbox map renders the concession polygons and enables hover tooltips

The MCP server is the single boundary for all geospatial logic — the TypeScript
backend never performs any spatial computation itself (except UTM centroid averaging
and the forward Snyder TM for centroid display).

**Special trigger modes** bypass the LLM router entirely and execute a fixed action:

| Trigger | Keyword pattern | Action |
|---------|----------------|--------|
| `DRAW_POLYGON_TRIGGER` | `dibuja.*polígono` / `draw.*polygon` | Extract UTM vertices → draw polygon on map |
| `OVERLAP_TRIGGER` | `traslap[ae]` or all of `polígono+concesión+minera` | Overlap analysis around previously drawn polygon centroid |

---

## Architecture

```
Browser
  │
  │  WebSocket (ws://)
  ▼
Node.js Backend  (Express + ws)
  │
  ├── 1. Request arrives at skillsFirstConversation()
  │       │
  │       ├── DRAW_POLYGON_TRIGGER?  ──► handleDrawPolygonFromDocument()
  │       │                               (bypasses LLM router entirely)
  │       │
  │       ├── OVERLAP_TRIGGER?  ──────► handleOverlapAnalysis()
  │       │                               (bypasses LLM router entirely)
  │       │
  │       └── PsRagRouter (LLM call)
  │               classifies intent: "geospatial" | "rag" | "evaluation" | "conversational"
  │
  ├── 2. handleGeospatialQuery()
  │       │
  │       ├── GeoMCPClient.connect()
  │       │     spawns:  python3 mcp-service/server.py
  │       │     protocol: JSON-RPC 2.0 over stdio (MCP)
  │       │
  │       ├── GeoMCPClient.listToolsForClaude()
  │       │     ← tools/list  (MCP request)
  │       │     → [{name, description, input_schema}, ...]
  │       │
  │       ├── openaiClient.chat.completions.create()
  │       │     model: gpt-4o-mini
  │       │     tools: [geo tools only]          ← no RAG tools here
  │       │     → tool_call: query_concessions({place, radius_km})
  │       │
  │       ├── GeoMCPClient.callTool("query_concessions", {place, radius_km})
  │       │     ← tools/call  (MCP request)
  │       │     → GeoJSON FeatureCollection + circular search-buffer polygon
  │       │
  │       ├── wsClientSocket.send({ type: "map_concessions", data: {...} })
  │       │
  │       ├── streamAggregatedResponse()   ← numbered concession list (name + Estado)
  │       │
  │       └── GeoMCPClient.disconnect()   (Python process exits)
  │
  └── 3. Frontend receives WebSocket message
          │
          ├── dispatch(addGeojsonLayer(...))   ← Redux
          ├── dispatch(setBounds(...))          ← fly map to results
          └── Map renders concession polygons + hover tooltips
```

**Key design principle:** geospatial tools are only given to the LLM when the router
detects a `geospatial` intent. RAG/evaluation paths never see them, preventing tool
overload and hallucination.

---

## File Structure

```
backend/
├── mcp-service/                     Python MCP server (geospatial logic)
│   ├── server.py                    FastMCP server — exposes 4 tools
│   ├── tools/                       Tool modules (imported by server.py)
│   │   ├── __init__.py
│   │   ├── geocatmin_spatial.py     Spatial query engine (Shapely + AE projection)
│   │   ├── geocode.py               Mapbox Geocoding API wrapper
│   │   └── polygon_from_document.py UTM→WGS84 converter (pure Python, no pyproj)
│   ├── requirements.txt             Python dependencies
│   ├── data/
│   │   └── Catastro.geojson         34 876 GEOCATMIN concession polygons (WGS84)
│   └── MCP_README.md                This file
│
└── src/chatbot/
    ├── mcpGeoClient.ts              TypeScript MCP client (stdio transport)
    ├── router.ts                    Intent classifier — adds "geospatial" intent
    └── skillsFirstChatBotFirestore.ts
                                     Orchestration: connect → list tools → LLM →
                                     execute → WebSocket → summary;
                                     DRAW_POLYGON and OVERLAP triggers bypass routing

frontend/
├── components/research/
│   └── research-chatbot.jsx         Handles "map_concessions" WS message;
│                                    Catastro Minero @ token
└── layout/explore/explore-map/
    └── component.jsx                Renders layers + hover tooltips
```

---

## Component Reference

### MCP Server — server.py

**Location:** `backend/mcp-service/server.py`

Runs as a stdio process spawned on demand by the TypeScript backend. Uses
[FastMCP](https://github.com/modelcontextprotocol/python-sdk) to expose four tools
via the MCP protocol.

```python
from mcp.server.fastmcp import FastMCP
from tools.geocode import geocode_address
from tools.geocatmin_spatial import retrieve_mining_concessions, _load_features
from tools.polygon_from_document import polygon_from_utm_vertices, _utm_to_latlon

mcp = FastMCP("Geodata MCP Server")

@mcp.tool()
def query_concessions(place: str = "", radius_km: float = 20.0,
                      easting: float = 0.0, northing: float = 0.0,
                      utm_zone: int = 18, hemisphere: str = "S") -> dict:
    """Find GEOCATMIN mining concessions within radius_km of a place or UTM coordinate."""
    ...

@mcp.tool()
def get_layer(layer_id: str) -> dict:
    """Return WMS/ArcGIS layer metadata for the frontend."""
    ...

@mcp.tool()
def buffer_analysis(concession_names: list, buffer_km: float = 5.0) -> dict:
    """Buffer a set of concessions and return the union geometry."""
    ...

@mcp.tool()
def draw_document_polygon(vertices: list, utm_zone: int = 18,
                          hemisphere: str = "S") -> dict:
    """Convert UTM vertex list into a GeoJSON Polygon (WGS84)."""
    ...

if __name__ == "__main__":
    mcp.run()   # stdio transport
```

The server is **stateless** — it is spawned per request and exits when the client
closes the connection. The GeoJSON dataset is cached in memory within a single
process lifetime (`_cached_features` in `geocatmin_spatial.py`).

---

### MCP Client — mcpGeoClient.ts

**Location:** `backend/src/chatbot/mcpGeoClient.ts`

Wraps `@modelcontextprotocol/sdk` to provide a typed, async interface.

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class GeoMCPClient {
  async connect(): Promise<void> {
    // Spawns python3 mcp-service/server.py via StdioClientTransport
    // Completes the MCP initialize handshake
  }

  async listToolsForClaude(): Promise<ClaudeTool[]> {
    // Calls tools/list on the MCP server
    // Converts MCP inputSchema → Claude/OpenAI input_schema
    // Returns [{name, description, input_schema}, ...]
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Calls tools/call on the MCP server
    // Parses the first text content block as JSON
    // Returns the parsed tool result
  }

  async disconnect(): Promise<void> {
    // Closes the MCP session → Python process exits
  }
}
```

**Python executable resolution** (in order of preference):

```typescript
function resolvePythonExecutable(mcpServiceDir: string): string {
  const venvPython = join(mcpServiceDir, "venv", "bin", "python");
  if (existsSync(venvPython)) {
    // validates interpreter is actually runnable
    return venvPython;
  }
  return process.env.PYTHON_EXECUTABLE || "python3";
}
```

---

### Intent Router — router.ts

**Location:** `backend/src/chatbot/router.ts`

LLM-based intent classifier. Extended with a `geospatial` intent type.

```typescript
export type PolicyAIXIntent =
  | 'rag'
  | 'evaluation'
  | 'conversational'
  | 'geospatial';      // ← added

export interface PolicyAIXRoutingResponse extends PsRagRoutingResponse {
  intent: PolicyAIXIntent;
  primaryCategory: string;
  // Note: no geocatminPlace / geocatminRadiusKm here anymore.
  // The geospatial LLM agent reads the raw user message directly.
}
```

The system prompt instructs the LLM:

```
"geospatial": the user is asking about mining concessions, GEOCATMIN,
nearby concessions, concesiones mineras, wants to find mining areas near
a location, asks about map layers (vegetation, protected areas,
communities), or requests spatial/buffer analysis in Peru
```

**Note:** `DRAW_POLYGON_TRIGGER` and `OVERLAP_TRIGGER` are regex-checked **before**
the router LLM call, so those requests never reach the router.

---

### Chatbot Orchestration — skillsFirstChatBotFirestore.ts

**Location:** `backend/src/chatbot/skillsFirstChatBotFirestore.ts`

Entry point is `skillsFirstConversation()`. Flow with all trigger modes:

```typescript
// 1. Check DRAW_POLYGON_TRIGGER first (before router)
if (DRAW_POLYGON_TRIGGER.test(userLastMessage)) {
  await this.handleDrawPolygonFromDocument(userLastMessage);
  return;
}

// 2. Check OVERLAP_TRIGGER (before router)
if (OVERLAP_TRIGGER.test(userLastMessage)) {
  await this.handleOverlapAnalysis(userLastMessage);
  return;
}

// 3. Normal LLM routing
const routingData = await this.router.getRoutingData(...);
if (routingData.intent === 'geospatial') {
  await this.handleGeospatialQuery(userLastMessage);
  return;
}
// ... rag / evaluation / conversational paths
```

#### handleGeospatialQuery

```typescript
private async handleGeospatialQuery(userLastMessage: string): Promise<void> {
  const geoClient = new GeoMCPClient();
  await geoClient.connect();                      // spawn Python server

  const geoTools = await geoClient.listToolsForClaude();

  const llmResponse = await this.openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    tools: openAiTools,
    tool_choice: "auto",
    messages: [
      { role: "system", content: "You are a geospatial assistant ..." },
      { role: "user",   content: userLastMessage },
    ],
  });

  const toolCall = llmResponse.choices[0].message.tool_calls?.[0];

  const toolResult = await geoClient.callTool(
    toolCall.name,
    JSON.parse(toolCall.function.arguments)
  );

  // Handle each tool result type:
  if (toolName === "query_concessions" && toolResult?.ok) {
    // Send map_concessions WS event
    // Stream numbered concession list with name + Estado (LEYENDA ?? D_ESTADO)
  } else if (toolName === "buffer_analysis" && toolResult?.ok) {
    // Send map_concessions WS event with buffered union geometry
  } else if (toolName === "draw_document_polygon" && toolResult?.ok) {
    // Send map_concessions WS event with source: 'documento'
    // Compute centroid in UTM 18S and include in confirmation text
  } else if (toolName === "get_layer") {
    // Stream layer info text to chat
  }

  await geoClient.disconnect();
}
```

#### handleDrawPolygonFromDocument

Triggered directly by `DRAW_POLYGON_TRIGGER` **without** going through the router.

```typescript
private async handleDrawPolygonFromDocument(userMessage: string = ''): Promise<void> {
  // 1. Try to extract UTM vertex table from the user's OWN message first
  let vertices = extractUtmVertices(userMessage);

  // 2. Fall back: scan last 10 chatLog entries (bot/assistant messages)
  if (vertices.length < 3) {
    for (const entry of this.memory.chatLog.slice(-10).reverse()) {
      if (entry.sender !== 'bot' && entry.sender !== 'assistant') continue;
      vertices = extractUtmVertices(entry.message);
      if (vertices.length >= 3) break;
    }
  }

  if (vertices.length < 3) {
    await this.streamAggregatedResponse("No se encontró una tabla de coordenadas UTM...");
    return;
  }

  const utmZone = extractUtmZone(userMessage) ?? 18;   // default Zone 18S
  const result  = await geoClient.callTool('draw_document_polygon', { vertices, utm_zone: utmZone, hemisphere: 'S' });

  // Send map_concessions WS event with source: 'documento', orange color, label
  // Compute centroid (average easting/northing) and display in UTM 18S
}
```

**Vertex extraction (`extractUtmVertices`):**
- Looks for a `CUADRO DE COORDENADAS UTM` section first; falls back to full text
- Parses rows matching `V-N  ESTE_X  NORTE_Y` (flexible whitespace/separators)
- Plausibility filter: ESTE 100 000–900 000, NORTE 7 000 000–10 000 000

**Zone extraction (`extractUtmZone`):**
- Regex matches `Zona 18S`, `Huso 19`, `UTM 18`, etc.
- Defaults to Zone **18S** if no zone found

#### handleOverlapAnalysis

Triggered by `OVERLAP_TRIGGER` when the user asks about traslape/overlap between
a previously drawn polygon and mining concessions.

```typescript
private async handleOverlapAnalysis(userMessage: string): Promise<void> {
  // Step 1: detect centroid — priority order:
  //   a) extractCentroidFromChatLog() → scans for "📍 Centroide" line in chat history
  //   b) extractUtmVertices() → recalculates centroid from the vertex table
  //   c) Guide the user to draw a polygon first

  // Step 2: convert centroid to WGS84 via _utm_to_latlon (Zone 18S)

  // Step 3: call query_concessions at 0.65 km radius via MCP

  // Step 4: send map_concessions WS event so concessions render on the map

  // Step 5: stream numbered list:
  //   "N. **CONCESION NAME** — Estado: LEYENDA_VALUE — Titular: TIT_CONCES"
  //   + "📍 Centroide analizado: ESTE **X**, NORTE **Y** (UTM 18S)"
}
```

**Centroid detection (`extractCentroidFromChatLog`):**

```typescript
// Looks for the line the bot emitted after drawing a polygon:
// "📍 Centroide (UTM 18S): ESTE **578.341**, NORTE **8.250.573**"
private extractCentroidFromChatLog(): { easting: number; northing: number } | null {
  const RE = /📍\s*Centroide[^:]*:\s*ESTE\s*\**([0-9][0-9.,\s]*)\**[,\s]+NORTE\s*\**([0-9][0-9.,\s]*)\**/i;
  for (const entry of [...this.memory.chatLog].reverse()) {
    if (entry.sender !== 'bot' && entry.sender !== 'assistant') continue;
    const m = entry.message.match(RE);
    if (m) {
      const easting  = parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.'));
      const northing = parseFloat(m[2].replace(/[.\s]/g, '').replace(',', '.'));
      if (northing > 1_000_000) return { easting, northing };
    }
  }
  return null;
}
```

#### latLonToUtm

Forward Transverse Mercator implemented in TypeScript (Snyder 1987, WGS84 ellipsoid),
used to display the polygon centroid in UTM 18S coordinates:

```typescript
private latLonToUtm(lat: number, lon: number, zone: number = 18):
    { easting: number; northing: number } { ... }
```

#### Concession list response format

Both `query_concessions` and `handleOverlapAnalysis` build numbered lists using
`LEYENDA ?? D_ESTADO` labeled as **Estado**:

```
Se encontraron **N** concesiones mineras cerca de **Place** (radio: R km):

1. **CONCESION NAME** — Estado: VIGENTE
2. **CONCESION NAME** — Estado: EN TRÁMITE — Titular: EMPRESA S.A.C.
...

Puedes verlas en el mapa.
```

---

### Frontend — research-chatbot.jsx

**Location:** `frontend/components/research/research-chatbot.jsx`

#### map_concessions WebSocket handler

Handles three sub-types of map result:

```javascript
case 'map_concessions': {
  const { geojson, buffer, place, features } = message.data;
  const isDocumentPolygon = features?.[0]?.properties?.source === 'documento';

  if (isDocumentPolygon) {
    // Orange polygon with centroid label symbol layer
    dispatch(addGeojsonLayer({
      id: `document-polygon-${Date.now()}`,
      layerConfig: {
        render: {
          layers: [
            { type: 'fill',   paint: { 'fill-color': '#f97316', 'fill-opacity': 0.35 } },
            { type: 'line',   paint: { 'line-color': '#ea580c', 'line-width': 2 } },
            { type: 'symbol', layout: {
                'text-field':             ['get', 'label'],
                'text-size':              13,
                'text-offset':            [0, -1],
                'text-allow-overlap':     true,
                'text-ignore-placement':  true,
              },
              paint: { 'text-color': '#fff', 'text-halo-color': '#ea580c', 'text-halo-width': 2 }
            },
          ],
        },
      },
    }));
  } else {
    // Normal green concession polygons + blue dashed buffer ring
    dispatch(addGeojsonLayer({ id: `geocatmin-concessions-${Date.now()}`, ... }));
    if (buffer) dispatch(addGeojsonLayer({ id: `geocatmin-buffer-${Date.now()}`, ... }));
  }

  // Fly map to bounding box of results
  dispatch(setBounds({ bbox: computeGeojsonBbox(geojson), options: { padding: 60 } }));
  break;
}
```

The feature `properties.label` is set to `'Polígono del documento'` in the WS payload
so it appears as a centroid label even when zoomed out.

#### Catastro Minero @ token

A fixed synthetic dataset token that renders the full Catastro GeoJSON on the map
**without** triggering RAG ingestion.

```javascript
const CATASTRO_DATASET = {
  id: '__catastro__',
  _isCatastro: true,
  slug: 'catastro-minero',
  name: 'Catastro Minero (GEOCATMIN)',
  ...
};
```

**selectDataset — `_isCatastro` branch:**

```javascript
// Fetch from backend (GET /policy_research/catastro-geojson)
const res = await fetch('/api/policy_research/catastro-geojson');
const geojson = await res.json();

// Render tiles with fixed layer ID for stable removal
dispatch(addGeojsonLayer({
  id: 'catastro-minero',
  name: 'Catastro Minero (GEOCATMIN)',
  layerConfig: {
    render: {
      layers: [
        { type: 'fill', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.3 } },
        { type: 'line', paint: { 'line-color': '#16a34a', 'line-width': 0.6 } },
      ],
    },
  },
}));

// Fly to Peru bounding box
dispatch(setBounds({ bbox: [-82, -18, -68, 0], options: { padding: 20 } }));
```

**removeDataset — `_isCatastro` branch:**

```javascript
// Removes the tile layer from the map using the fixed ID
dispatch(removeGeojsonLayer('catastro-minero'));
```

The backend route serving the file:

```typescript
// GET /policy_research/catastro-geojson
// chatController.ts → serveCatastroFile()
const catastroPath = join(process.cwd(), 'mcp-service', 'data', 'Catastro.geojson');
res.sendFile(catastroPath);
```

---

### Map Layer Rendering — explore-map/component.jsx

**Location:** `frontend/layout/explore/explore-map/component.jsx`

#### Interactive layer IDs

The vizzuality layer manager names sub-layers `${parentId}-${type}-${index}`.
This convention is used to compute `interactiveLayerIds` dynamically:

```javascript
const geocatminInteractiveLayerIds = useMemo(() => {
  return (geojsonLayers || [])
    .filter((l) => l.id?.startsWith('geocatmin-concessions-'))
    .flatMap((l) =>
      (l.layerConfig?.render?.layers || []).map(
        (sl, i) => sl.id || `${l.id}-${sl.type}-${i}`
      )
    );
}, [geojsonLayers]);
```

#### Hover handler

```javascript
const onHoverLayer = useCallback(({ features, point }) => {
  if (!features?.length) { setGeocatminTooltip(null); return; }
  const hit = features.find(
    (f) => f.layer?.source?.startsWith('geocatmin-concessions-')
  );
  if (hit) setGeocatminTooltip({ x: point[0], y: point[1], properties: hit.properties });
  else setGeocatminTooltip(null);
}, []);
```

#### Hover tooltip

Enlarged card using `LEYENDA` (with `D_ESTADO` fallback) for concession status:

```jsx
{geocatminTooltip && (
  <div style={{
    position: 'absolute',
    left: geocatminTooltip.x,
    top: geocatminTooltip.y,
    transform: 'translate(-50%, calc(-100% - 14px))',
    background: 'rgba(15, 23, 42, 0.95)',
    color: '#f1f5f9',
    padding: '14px 18px',
    borderRadius: '10px',
    fontSize: '14px',
    lineHeight: '1.6',
    maxWidth: '320px',
    minWidth: '220px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    zIndex: 9999,
  }}>
    <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>
      {p.CONCESION || '—'}
    </div>
    <div style={{ color: '#7dd3fc', fontWeight: 600, marginBottom: '4px' }}>
      {p.LEYENDA || p.D_ESTADO || ''}          {/* LEYENDA preferred */}
    </div>
    {p.TIT_CONCES && <div>👤 {p.TIT_CONCES}</div>}
    {p.HASDATUM   && <div>📐 {parseFloat(p.HASDATUM).toFixed(1)} ha{p.DEPA ? ` · ${p.DEPA}` : ''}</div>}
  </div>
)}
```

Fields shown: `CONCESION` (title) · `LEYENDA`/`D_ESTADO` (status, blue) · `TIT_CONCES` (👤) · `HASDATUM` + `DEPA` (📐)

---

## Special Trigger Modes

### DRAW_POLYGON_TRIGGER

**Regex:** `/dibuja[r]?\s+(el\s+)?(polígono|poligono)|draw\s+(\w+\s+)?polygon/i`

Fires when the user asks to draw a polygon from a UTM coordinate table. Completely
bypasses the LLM router.

**Vertex search order:**
1. User's own current message (supports pasting a raw UTM table inline)
2. Last 10 chatLog entries from `bot` or `assistant` (catches tables extracted from uploaded PDFs)

**Result on the map:**
- Orange fill (`#f97316`, 35% opacity) + dark orange outline
- Mapbox `symbol` layer at centroid with text `'Polígono del documento'` (always visible)
- Map flies to polygon bounding box

**Confirmation message format:**
```
✅ Polígono dibujado en el mapa con N vértices (UTM Zona 18S → WGS84).

📍 Centroide (UTM 18S): ESTE **578.341**, NORTE **8.250.573**
```

---

### OVERLAP_TRIGGER

**Regex:** `/traslap[ae]|(\bpolígono\b.*\bconcesi[oó]n\b.*\bminera\b)/i`

Fires when the user asks about overlap between a drawn polygon and mining concessions.
Completely bypasses the LLM router.

**Centroid detection hierarchy:**
1. **`📍 Centroide` line** in chat history — strongest signal; extracts easting/northing
   from the bot's own confirmation message (written after DRAW_POLYGON runs)
2. **UTM vertex table** in chat history — recalculates centroid as average
   (easting / northing) of all vertices
3. **Guide message** if neither found

**Fixed parameters:**
- Search radius: **0.65 km** around the centroid
- UTM zone: **18S** (WGS84)

**Result on the map:** sends `map_concessions` WS event → concessions rendered as green polygons

**Response message format:**
```
Se encontraron **N** concesión(es) minera(s) dentro de los 0.65 km del polígono:

1. **CONCESION NAME** — Estado: LEYENDA — Titular: TIT_CONCES
2. ...

📍 Centroide analizado: ESTE **578.341**, NORTE **8.250.573** (UTM 18S)
```

---

### Catastro Minero @ Token

The `@` token input in the research chatbot includes a synthetic entry for
**Catastro Minero (GEOCATMIN)** that triggers when the user types `catastro`,
`minero`, `geocatmin`, or `ingemmet`.

Selecting the token:
- Fetches `GET /policy_research/catastro-geojson` (34 876 polygons, ~65 MB)
- Renders all polygons as a tile layer with fixed layer ID `catastro-minero`
- No RAG ingestion is triggered

Clicking the `×` close button on the token:
- Dispatches `removeGeojsonLayer('catastro-minero')` → tiles removed from map

---

## MCP Protocol — How it Works

MCP (Model Context Protocol) is a JSON-RPC 2.0 protocol over stdio. The TypeScript
client and Python server exchange newline-delimited JSON messages through
stdin/stdout.

### Session lifecycle

```
TypeScript (client)                Python (server)
───────────────────                ───────────────
spawn python3 server.py
                        ────────►  server starts, waits on stdin
initialize request      ────────►
                        ◄────────  initialized response
tools/list request      ────────►
                        ◄────────  [{name, inputSchema, description}, ...]
tools/call request      ────────►
  { name, arguments }
                        ◄────────  { content: [{ type: "text", text: "..." }] }
client.close()          ────────►  server exits (stdin EOF)
```

### Example: tools/list response

```json
{
  "tools": [
    {
      "name": "query_concessions",
      "description": "Find mining concessions (GEOCATMIN) within a given radius ...",
      "inputSchema": {
        "type": "object",
        "properties": {
          "place":      { "type": "string" },
          "radius_km":  { "type": "number", "default": 20.0 },
          "easting":     { "type": "number", "default": 0.0 },
          "northing":    { "type": "number", "default": 0.0 },
          "utm_zone":   { "type": "integer", "default": 18 },
          "hemisphere": { "type": "string", "default": "S" }
        }
      }
    }
  ]
}
```

### Example: tools/call request + response

Request:
```json
{
  "method": "tools/call",
  "params": {
    "name": "query_concessions",
    "arguments": { "place": "Caravelí", "radius_km": 20 }
  }
}
```

Response (abbreviated):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"ok\":true,\"type\":\"FeatureCollection\",\"features\":[...],\"buffer\":{...},\"geo\":{\"lat\":-15.77,\"lon\":-73.36,\"place_name\":\"Caravelí, Arequipa, Peru\"}}"
  }]
}
```

---

## End-to-End Request Walkthrough

### Query by place name

**User types:** `"concesiones mineras cerca de Caravelí, radio 30 km"`

```
1. DRAW_POLYGON_TRIGGER?  no
   OVERLAP_TRIGGER?       no
   PsRagRouter → intent: "geospatial"

2. handleGeospatialQuery("concesiones mineras cerca de Caravelí, radio 30 km")
   │
   ├── GeoMCPClient.connect()  →  spawns python3 server.py
   ├── listToolsForClaude()    →  [query_concessions, get_layer, buffer_analysis, draw_document_polygon]
   ├── gpt-4o-mini selects:    →  query_concessions({ place: "Caravelí", radius_km: 30 })
   ├── callTool()              →  Python: geocode → retrieve → 134 features
   ├── wsClientSocket.send({ type: "map_concessions", data: { geojson, buffer, ... } })
   ├── streamAggregatedResponse("Se encontraron **134** concesiones ... \n1. **CERRO VERDE** — Estado: VIGENTE\n...")
   └── disconnect()

3. Frontend
   ├── addGeojsonLayer("geocatmin-concessions-...")  → 134 green polygons
   ├── addGeojsonLayer("geocatmin-buffer-...")        → blue dashed circle
   └── setBounds(...)                                 → map flies to Caravelí
```

### Query by UTM coordinates

**User types:** `"concesiones mineras en ESTE 350000 NORTE 8500000, radio 5 km"`

```
gpt-4o-mini selects: query_concessions({ easting: 350000, northing: 8500000, radius_km: 5 })

Python server.py:
  _utm_to_latlon(350000, 8500000, zone=18, northern=False)  →  lat, lon
  retrieve_mining_concessions(lat, lon, 5)                  →  N features
```

### Draw polygon from document

**User types:** `"dibuja el polígono del documento"` (after uploading a PDF)

```
1. DRAW_POLYGON_TRIGGER matches → handleDrawPolygonFromDocument()
2. extractUtmVertices(chatLog) → [{vertice:"V-1", easting:350000, northing:8500000}, ...]
3. callTool('draw_document_polygon', { vertices, utm_zone: 18, hemisphere: 'S' })
4. Python: polygon_from_utm_vertices() → GeoJSON Polygon (WGS84)
5. wsClientSocket.send({ type: "map_concessions", source: "documento", label: "Polígono del documento" })
6. Frontend: orange polygon + symbol label rendered on map
7. streamAggregatedResponse("✅ Polígono dibujado ... 📍 Centroide (UTM 18S): ESTE **X**, NORTE **Y**")
```

### Draw polygon from inline table

**User pastes UTM table directly in message:**

```
Dibuja este polígono:
V-1  350000  8500000
V-2  351000  8500000
V-3  351000  8501000
V-4  350000  8501000
```

```
1. DRAW_POLYGON_TRIGGER matches → handleDrawPolygonFromDocument(userMessage)
2. extractUtmVertices(userMessage) → 4 vertices found directly in user's message
3. Same flow as above → polygon drawn on map
```

### Overlap analysis

**User types:** `"analiza el traslape entre el polígono y concesiones mineras"`

```
1. OVERLAP_TRIGGER matches → handleOverlapAnalysis()
2. extractCentroidFromChatLog() → finds "📍 Centroide (UTM 18S): ESTE **350.500**, NORTE **8.500.500**"
3. Parse → easting: 350500, northing: 8500500
4. _utm_to_latlon(350500, 8500500, 18, false) → lat, lon
5. callTool('query_concessions', { easting: 350500, northing: 8500500, radius_km: 0.65 })
6. wsClientSocket.send({ type: "map_concessions", ... })
7. streamAggregatedResponse("Se encontraron **N** concesión(es) ...\n1. **NAME** — Estado: VIGENTE\n...\n📍 Centroide: ...")
```

---

## Tool Reference

### query_concessions

Find GEOCATMIN mining concessions within a radius of a Peruvian location.

Accepts **two mutually exclusive input modes**:

| Mode | Parameters used |
|------|----------------|
| Place name | `place` (geocoded via Mapbox API) |
| UTM coordinates | `easting` + `northing` (+ optional `utm_zone`, `hemisphere`) |

| Parameter    | Type    | Default | Description                                      |
|--------------|---------|---------|--------------------------------------------------|
| `place`      | string  | `""`    | Place name. Leave empty when using UTM mode.     |
| `radius_km`  | number  | 20.0    | Search radius in km (max 100)                    |
| `easting`     | number  | 0.0     | UTM Easting in metres. Only used when place="". |
| `northing`    | number  | 0.0     | UTM Northing in metres. Only used when place="". |
| `utm_zone`   | integer | 18      | UTM zone number (default 18 — Peru)              |
| `hemisphere` | string  | `"S"`   | `"N"` or `"S"` (default `"S"` — Southern Peru)  |

**Returns:**
```json
{
  "ok": true,
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": {
        "CONCESION":  "CERRO VERDE 5",
        "LEYENDA":    "VIGENTE",
        "D_ESTADO":   "VIGENTE",
        "TIT_CONCES": "MINERA ABC S.A.C.",
        "HASDATUM":   "450.23",
        "DEPA":       "AREQUIPA",
        "SUSTANCIA":  "COBRE"
      }
    }
  ],
  "buffer": { "type": "Polygon", "coordinates": [[...]] },
  "geo": { "lat": -15.77, "lon": -73.36, "place_name": "Caravelí, Arequipa, Peru" }
}
```

---

### get_layer

Return metadata for a WMS or ArcGIS map layer.

| Parameter  | Type   | Description              |
|------------|--------|--------------------------|
| `layer_id` | string | Identifier of the layer  |

Available `layer_id` values:

| ID                          | Type    | Source   |
|-----------------------------|---------|----------|
| `catastro_minero`           | geojson | INGEMMET |
| `cobertura_vegetal`         | wms     | MINAM    |
| `areas_naturales_protegidas`| arcgis  | SERNANP  |
| `comunidades_campesinas`    | wms     | COFOPRI  |

**Returns:**
```json
{
  "ok": true,
  "layer": {
    "id": "cobertura_vegetal",
    "name": "Cobertura Vegetal",
    "type": "wms",
    "url": "https://geoservidor.minam.gob.pe/geoserver/wms",
    "layer": "minam:cobertura_vegetal",
    "description": "Vegetation coverage — MINAM",
    "source": "MINAM"
  }
}
```

---

### buffer_analysis

Spatial buffer analysis on a set of named concessions.

| Parameter          | Type     | Default | Description                          |
|--------------------|----------|---------|--------------------------------------|
| `concession_names` | string[] | —       | CONCESION field values to match      |
| `buffer_km`        | number   | 5.0     | Buffer distance in km (max 50)       |

**Returns:**
```json
{
  "ok": true,
  "count": 3,
  "matched": ["CERRO VERDE 1", "CERRO VERDE 2", "CERRO VERDE 3"],
  "buffer_km": 5.0,
  "geometry": { "type": "MultiPolygon", "coordinates": [[...]] }
}
```

---

### draw_document_polygon

Convert UTM coordinate vertices into a GeoJSON Polygon (WGS84). Can be triggered two ways:

1. **From uploaded PDF** — backend extracts vertices from Firestore markdown, calls MCP
2. **From inline user message** — user pastes a raw UTM table; backend extracts directly from the message text

The LLM is **not** involved in argument assembly for this tool — the backend handles
vertex extraction via `extractUtmVertices()` before calling MCP.

| Parameter    | Type     | Default | Description                                         |
|--------------|----------|---------|-----------------------------------------------------|
| `vertices`   | object[] | —       | List of `{vertex, easting, northing}` dicts         |
| `utm_zone`   | integer  | **18**  | UTM zone number (default 18 — western/central Peru) |
| `hemisphere` | string   | `"S"`   | `"N"` (Northern) or `"S"` (Southern Hemisphere)    |

**Returns:**
```json
{
  "ok": true,
  "vertex_count": 6,
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [-71.9876, -16.4321],
      [-71.9856, -16.4321],
      [-71.9856, -16.4298],
      [-71.9876, -16.4298],
      [-71.9876, -16.4310],
      [-71.9876, -16.4321]
    ]]
  }
}
```

**Coordinate conversion:** Uses WGS84 ellipsoid (a = 6 378 137 m, f = 1/298.257 223 563)
with the Transverse Mercator inverse equations (Snyder 1987 §8). No `pyproj` dependency.

**Map rendering:** Orange polygon (`#f97316`) with Mapbox `symbol` layer showing
`'Polígono del documento'` label at centroid — visible at all zoom levels.

---

## Data — Catastro.geojson

**Location:** `mcp-service/data/Catastro.geojson`

| Property    | Value                               |
|-------------|-------------------------------------|
| Source      | INGEMMET GEOCATMIN                  |
| CRS         | WGS84 (EPSG:4326)                   |
| Features    | 34 876 mining concession polygons   |
| Coverage    | Peru (lon −82° to −68°, lat −18° to −0°) |
| Format      | GeoJSON FeatureCollection           |

Key property fields per feature:

| Field        | Description                         | Used in UI            |
|--------------|-------------------------------------|-----------------------|
| `CONCESION`  | Concession name / identifier        | Tooltip title, lists  |
| `LEYENDA`    | Human-readable status label         | Tooltip (preferred)   |
| `D_ESTADO`   | Status code (VIGENTE, EXTINGUIDA…)  | Tooltip fallback      |
| `TIT_CONCES` | Titleholder (company or person)     | Tooltip 👤            |
| `HASDATUM`   | Area in hectares                    | Tooltip 📐            |
| `DEPA`       | Department                          | Tooltip 📐 suffix     |
| `SUSTANCIA`  | Mineral substance                   | Available in data     |

**Note:** The chatbot uses `LEYENDA ?? D_ESTADO` and always labels it **"Estado"**
in response text. The map tooltip shows `LEYENDA` (with `D_ESTADO` as fallback).

The file is lazy-loaded and cached in memory on first use inside `geocatmin_spatial.py`:

```python
_cached_features: Optional[List[Tuple[Any, dict]]] = None

def _load_features() -> List[Tuple[Any, dict]]:
    global _cached_features
    if _cached_features is not None:
        return _cached_features
    with open(_GEOJSON_PATH, encoding="utf-8") as f:
        collection = json.load(f)
    features = []
    for feat in collection.get("features", []):
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)   # topology repair
        features.append((geom, feat.get("properties", {})))
    _cached_features = features
    return _cached_features
```

### Spatial query — Azimuthal Equidistant buffer

A true circular buffer is computed using the AE projection (no pyproj dependency):

```python
def _ae_buffer_wgs84(lat_deg, lon_deg, radius_km, n_points=64):
    """Returns a closed ring of [lon, lat] pairs representing a circle."""
    lat0, lon0 = math.radians(lat_deg), math.radians(lon_deg)
    r_m = radius_km * 1000.0
    ring = []
    for i in range(n_points):
        angle = 2 * math.pi * i / n_points
        lat_r, lon_r = _ae_inverse(r_m * math.cos(angle), r_m * math.sin(angle), lat0, lon0)
        ring.append([math.degrees(lon_r), math.degrees(lat_r)])
    ring.append(ring[0])   # close ring
    return ring
```

Intersection test using Shapely:

```python
buffer_poly = Polygon(ring)
matched = [
    {"type": "Feature", "geometry": mapping(geom), "properties": attrs}
    for geom, attrs in all_features
    if geom.intersects(buffer_poly)
]
```

---

## Environment Variables

| Variable              | Used by               | Description                          |
|-----------------------|-----------------------|--------------------------------------|
| `MAPBOX_ACCESS_TOKEN` | `geocode.py`          | Mapbox Geocoding API v5 token        |
| `OPENAI_API_KEY`      | Node.js chatbot       | OpenAI key (gpt-4o-mini)             |
| `PYTHON_EXECUTABLE`   | `mcpGeoClient.ts`     | Override Python path (optional)      |

The `.env` file in `mcp-service/` is loaded by `python-dotenv` at server startup.

---

## Dependencies

### Python (mcp-service/requirements.txt)

```
requests==2.32.5       # Mapbox Geocoding HTTP client
python-dotenv==1.2.1   # .env loading
shapely==2.1.2          # Spatial geometry and intersection tests
mcp[cli]>=1.0.0        # MCP server (FastMCP + stdio transport)
```

### Node.js (backend/package.json — relevant)

```json
"@modelcontextprotocol/sdk": "^1.x"   // MCP stdio client
```

The `@anthropic-ai/sdk` is available transitively through `@policysynth/agents`
but is **not used** by the geospatial pipeline. All LLM calls go through the
existing `this.openaiClient` (OpenAI `gpt-4o-mini`).

---

## Setup

### Python environment

The system Python3 must have the three packages installed, **or** set up a venv:

```bash
cd backend/mcp-service

# Option A: system Python (mcp package required globally)
pip install -r requirements.txt

# Option B: venv (recommended for isolated deployments)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

If a `venv/bin/python` is present and functional, `mcpGeoClient.ts` uses it
automatically. Otherwise it falls back to `python3`.

### Environment file

```bash
# backend/mcp-service/.env
MAPBOX_ACCESS_TOKEN=pk.eyJ1...
```

### Verify the server manually

```bash
cd backend/mcp-service
python3 server.py
# (server waits on stdin — Ctrl+C to exit)
```

### Smoke test via the Python entry point

```bash
cd backend/mcp-service
python3 -c "
import json, sys
sys.path.insert(0, '.')
sys.path.insert(0, 'tools')
from tools.geocode import geocode_address
from tools.geocatmin_spatial import retrieve_mining_concessions
geo = geocode_address('Caraveli, Peru')
r = retrieve_mining_concessions(geo['latitude'], geo['longitude'], 20)
print(f'ok={r[\"ok\"]}, features={len(r[\"features\"])}')
"
# ok=True, features=79
```

### Smoke test UTM mode

```bash
python3 -c "
import sys; sys.path.insert(0, 'tools')
from tools.polygon_from_document import _utm_to_latlon
from tools.geocatmin_spatial import retrieve_mining_concessions
lat, lon = _utm_to_latlon(350000, 8500000, 18, False)
r = retrieve_mining_concessions(lat, lon, 5)
print(f'lat={lat:.4f}, lon={lon:.4f}, features={len(r[\"features\"])}')
"
```

### Node.js

The `@modelcontextprotocol/sdk` package must be installed (Node 18+):

```bash
cd backend
npm install @modelcontextprotocol/sdk
```

No other installation steps are required — the MCP server is spawned automatically
when the first geospatial intent is received.
