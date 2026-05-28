# BE_MCP — Geospatial MCP Service (`mcp-service/`)

A standalone Python process that exposes geospatial tools to the chatbot via the **Model Context Protocol (MCP)** stdio transport. The backend spawns it on demand per geo turn; communication is JSON-RPC 2.0 over stdin/stdout.

---

## Architecture

```
SkillsFirstChatBot (async)
    │
    └─ GeoMCPClient.connect()
            │
            └─ subprocess: mcp-service/venv/bin/python server.py
                    │  (stdio JSON-RPC)
                    │
                    ├─ place_pins
                    ├─ render_polygons
                    ├─ compute_centroid
                    ├─ create_buffer
                    └─ run_deep_analysis
```

The subprocess is spawned per turn (not a persistent daemon). `connect()` and `disconnect()` must be called in the same asyncio task because the MCP SDK's anyio scopes are task-bound.

---

## `GeoMCPClient` (caller side)

Located at `app/chatbot/geo_mcp_client.py`.

```python
client = GeoMCPClient()

# Spawn subprocess and initialize MCP session
await client.connect()

# List tools as OpenAI function-calling schema
tools = await client.list_tools_for_openai()
# [{"type":"function","function":{"name":"render_polygons","parameters":{...}}}]

# Call a tool
result = await client.call_tool("render_polygons", {
    "place": "Caravelí, Arequipa",
    "radius_km": 20.0,
})

await client.disconnect()
```

### Python interpreter resolution

```python
def _resolve_python(self) -> str:
    venv = os.path.join(self.mcp_service_dir, "venv", "bin", "python")
    if os.path.exists(venv):
        return venv                               # 1. local venv (preferred)
    return os.getenv("PYTHON_EXECUTABLE") or "python3"  # 2. env override / system
```

### Response parsing

Every tool returns a JSON string as the first `TextContent` block. `call_tool` parses it:

```python
for c in result.content:
    if c.type == "text":
        return json.loads(c.text)
```

---

## Tools

### Tool 1: `place_pins`

Renders named locations as Point pins on the Mapbox map.

```python
place_pins(locations=[
    {"name": "Site A", "lat": -12.04, "lon": -77.03},
    {"name": "Office Lima", "address": "Av. Javier Prado Este 1234, Lima"},
])
```

- Geocodes entries that have only an `address` (no lat/lon) via Mapbox Geocoding API
- Extra properties (type, category, status) are forwarded to GeoJSON feature `properties`
- Returns a `FeatureCollection` of `Point` features

### Tool 2: `render_polygons`

Two modes:

#### Mode A — GEOCATMIN spatial query

Retrieves mining-concession polygons from the built-in 34,876-feature dataset near a location.

```python
# By place name
render_polygons(place="Caravelí, Arequipa", radius_km=20)

# By UTM coordinates
render_polygons(easting=314000, northing=8318000, utm_zone=18, hemisphere="S")
```

Returns: `FeatureCollection` of mining concessions + a circular buffer ring + `geo` object with resolved lat/lon.

#### Mode B — Explicit polygon geometry

```python
render_polygons(polygons=[
    {
        "name": "Document polygon",
        "utm_vertices": [
            {"vertex": "V-1", "easting": 276500.0, "northing": 8234500.0},
            {"vertex": "V-2", "easting": 276600.0, "northing": 8234500.0},
            # ...
        ],
        "utm_zone": 18,
        "hemisphere": "S",
    }
])

# Also accepts GeoJSON geometry objects directly:
render_polygons(polygons=[{"name": "Zone", "geometry": {"type": "Polygon", "coordinates": [...]}}])

# Or WGS84 coordinate rings:
render_polygons(polygons=[{"name": "Area", "coordinates": [[-77.03, -12.04], ...]}])
```

Sub-mode B1: full GeoJSON geometry → used as-is  
Sub-mode B2: `coordinates` ring → wrapped in Polygon geometry  
Sub-mode B3: `utm_vertices` → converted via `polygon_from_utm_vertices()` (Snyder 1987 UTM inverse)

### Tool 3: `compute_centroid`

Arithmetic mean center of a set of coordinate points.

```python
compute_centroid(points=[
    {"lat": -12.04, "lon": -77.03},
    {"lat": -12.05, "lon": -77.01},
])
# Returns: {"ok": True, "centroid": {"lat": -12.045, "lon": -77.02}, "geojson": {...}}
```

Uses `numpy.mean` on the coordinate array.

### Tool 4: `create_buffer`

True circular buffer using the Azimuthal Equidistant projection (preserves distances from center).

```python
create_buffer(lat=-12.046, lon=-77.043, radius_km=5)
```

Projection chain:
```
WGS84 → AEQD (centered on the point) → buffer(radius_km * 1000) → back to WGS84
```

Uses `shapely` + `pyproj`.

### Tool 5: `run_deep_analysis`

Runs a pre-built Python analysis script and returns a list of Plotly HTML visualization panels.

```python
run_deep_analysis(topic="chisinau")
# Returns: {"ok": True, "panels": [{"title": "...", "path": "...", "explanation": "..."}]}
```

The backend then streams each panel to the chatbot UI sequentially via WebSocket. Currently only supports the "chisinau" green-infrastructure analysis. The analysis script lives in `mcp-service/data/chinisau/`.

---

## UTM → WGS84 conversion

Implemented in `tools/polygon_from_document.py` using the Transverse Mercator inverse formulas (Snyder 1987, Professional Paper 1395). No external C-extension required.

```python
def _utm_to_latlon(easting, northing, zone, northern) -> tuple[float, float]:
    x = easting - 500_000.0        # remove false easting
    y = northing if northern else northing - 10_000_000.0  # false northing

    # Footprint latitude → exact latitude via series expansion
    # Central meridian: lon0 = (zone-1)*6 - 180 + 3
```

The vertex dict format expected:
```python
{"vertex": "V-1", "easting": 276500.0, "northing": 8234500.0}
# Backward-compat fallbacks: "este_x", "este", "x" / "norte_y", "norte", "y"
```

---

## GEOCATMIN spatial query (`tools/geocatmin_spatial.py`)

Queries the local `data/Catastro.geojson` — 34,876 Peruvian mining concessions.

```python
def retrieve_mining_concessions(lat, lon, radius_km) -> dict:
    # Haversine distance filter (pure Python, no spatial index)
    # Returns matching features as GeoJSON FeatureCollection
    # Also returns a circular buffer polygon for the search ring
```

The geojson file is loaded once at module import (in-process). All distance comparisons use the Haversine formula against each feature's centroid.

---

## Geocoding (`tools/geocode.py`)

Uses the Mapbox Geocoding API. Requires `MAPBOX_ACCESS_TOKEN` env var.

```python
def geocode_address(address: str) -> dict:
    # GET https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded_address}.json
    # Returns: {"ok": True, "latitude": ..., "longitude": ..., "display_name": ...}
```

---

## Dependencies (`mcp-service/requirements.txt`)

```
mcp[cli]>=1.0.0    # FastMCP server + stdio transport
shapely==2.1.2     # Geometry operations (create_buffer)
requests==2.32.5   # HTTP calls (geocoding)
python-dotenv==1.2.1
```

`pyproj` (coordinate projection) and `numpy` (centroid math) are imported lazily inside the tools that need them — they must be available in the venv.

---

## Setup

```bash
cd backend/mcp-service

# Create isolated venv (keeps deps separate from main app)
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Optional: Mapbox token for geocoding
echo "MAPBOX_ACCESS_TOKEN=pk.eyJ1..." > .env
```

---

## Testing a tool manually

```bash
cd backend/mcp-service
source venv/bin/activate

python - <<'EOF'
import asyncio, json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(command="python", args=["server.py"])
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            result = await s.call_tool("render_polygons", {"place": "Lima", "radius_km": 5})
            print(result.content[0].text[:500])

asyncio.run(main())
EOF
```
