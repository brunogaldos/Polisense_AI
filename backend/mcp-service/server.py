"""
Geodata MCP Server

Exposes geospatial tools to the Polisense backend chatbot via the
Model Context Protocol (MCP) stdio transport.  The backend spawns this
process on demand and communicates over stdin/stdout using JSON-RPC 2.0.

Tools
-----
place_pins      – Render a set of locations as Point pins on the Mapbox map.
                  Geocodes any entry that has an address but no lat/lon.

render_polygons – Render polygon zones / boundaries on the Mapbox map.
                  Two modes:
                    A) Spatial query  – give place name or UTM coordinates to
                       retrieve matching features from the local GEOCATMIN dataset.
                    B) Direct geometry – pass a list of polygon dicts whose
                       geometry can be expressed as WGS84 coordinate rings,
                       full GeoJSON geometry objects, or raw UTM vertex tables
                       (converted to WGS84 on the fly).
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(_HERE, "tools")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from mcp.server.fastmcp import FastMCP
from tools.geocode import geocode_address
from tools.geocatmin_spatial import retrieve_mining_concessions
from tools.polygon_from_document import polygon_from_utm_vertices, _utm_to_latlon

mcp = FastMCP("Geodata MCP Server")


# ---------------------------------------------------------------------------
# Tool 1: place_pins
# ---------------------------------------------------------------------------
@mcp.tool()
def place_pins(locations: list) -> dict:
    """
    Plot one or more named locations as pins on the Mapbox map.

    Each item in `locations` must be a dict containing:
      - name    (str)            : display label shown on the map pin
      - lat     (float, optional): WGS84 latitude  — skip if providing address
      - lon     (float, optional): WGS84 longitude — skip if providing address
      - address (str,  optional) : street / place name to geocode when lat/lon
                                   are not available
      Any additional key-value pairs are forwarded as GeoJSON feature properties
      (e.g. type, category, status, contact, notes).

    When both coordinates and an address are present the coordinates take
    precedence and no geocoding request is made.

    Returns a GeoJSON FeatureCollection of Point features.  Each feature's
    `properties` object contains all extra fields from the input item plus a
    `_geocoded` flag (true if coordinates were resolved via the Mapbox API).

    Args:
        locations: List of location dicts (name + coords or address).

    Examples (how the LLM should call this tool):
        place_pins([{"name":"Warehouse A","lat":-12.04,"lon":-77.03}])
        place_pins([{"name":"Office Lima","address":"Av. Javier Prado Este 1234, Lima"}])
        place_pins([{"name":"Site 1","lat":-8.11,"lon":-79.02,"type":"depot"},
                    {"name":"Site 2","lat":-13.52,"lon":-71.98,"type":"office"}])
    """
    if not locations:
        return {"ok": False, "error": "locations list is empty"}

    features = []
    errors = []

    for item in locations:
        if not isinstance(item, dict):
            errors.append(f"Skipped non-dict item: {item!r}")
            continue

        name = str(item.get("name", "")).strip() or "Location"
        lat  = item.get("lat")
        lon  = item.get("lon")
        geocoded = False

        # Resolve coordinates via geocoding if not provided
        if lat is None or lon is None:
            address = str(item.get("address", name)).strip()
            geo = geocode_address(address)
            if not geo.get("ok"):
                errors.append(f"Geocoding failed for '{name}': {geo.get('error')}")
                continue
            lat, lon = float(geo["latitude"]), float(geo["longitude"])
            geocoded = True
        else:
            lat, lon = float(lat), float(lon)

        # Build properties — exclude internal coord/address keys, keep extras
        props = {
            k: v for k, v in item.items()
            if k not in {"lat", "lon", "address"}
        }
        props["name"] = name
        props["_geocoded"] = geocoded

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 8), round(lat, 8)]},
            "properties": props,
        })

    if not features:
        return {
            "ok": False,
            "error": "No valid locations could be resolved.",
            "details": errors,
        }

    result = {
        "ok": True,
        "type": "FeatureCollection",
        "features": features,
        "count": len(features),
    }
    if errors:
        result["warnings"] = errors
    return result


# ---------------------------------------------------------------------------
# Tool 2: render_polygons
# ---------------------------------------------------------------------------
@mcp.tool()
def render_polygons(
    polygons: list = None,
    place: str = "",
    radius_km: float = 20.0,
    easting: float = 0.0,
    northing: float = 0.0,
    utm_zone: int = 18,
    hemisphere: str = "S",
) -> dict:
    """
    Render polygon zones, boundaries, regions, or parcels on the Mapbox map.

    ── MODE A — Spatial query (GEOCATMIN dataset) ──────────────────────────
    Retrieve mining-concession polygons near a location from the built-in
    34 876-feature GEOCATMIN dataset.  Provide ONE of:
      • place (str)                 : place name (e.g. "Caravelí, Arequipa")
      • easting + northing (float)  : UTM Easting / Northing in metres
    Optional parameters for Mode A:
      • radius_km  (float, default 20): search radius in km (max 100)
      • utm_zone   (int,   default 18): UTM zone (for UTM-coordinate mode)
      • hemisphere (str,   default S) : "N" or "S"

    ── MODE B — Explicit polygon geometry ─────────────────────────────────
    Pass a list of polygon dicts when geometry is already available (e.g.
    retrieved from the user's uploaded GeoJSON / RAG memory store).  Each
    dict must contain ONE of:
      • geometry (dict)      : complete GeoJSON geometry object
                               (Polygon or MultiPolygon)
      • coordinates (list)   : exterior ring  [[lng,lat], [lng,lat], ...]
                               (WGS84, counterclockwise)
      • utm_vertices (list)  : raw UTM table [{easting, northing, vertex?},...]
                               converted to WGS84 using utm_zone / hemisphere
    Plus:
      • name       (str)            : polygon label
      • properties (dict, optional) : extra metadata forwarded to the map
      • utm_zone   (int,  optional) : UTM zone for this polygon's vertices
      • hemisphere (str,  optional) : "N"/"S" for this polygon's vertices

    Returns a GeoJSON FeatureCollection of Polygon / MultiPolygon features.
    Mode A also returns a circular `buffer` search-ring polygon and a `geo`
    object with the resolved lat/lon and place name.

    Args:
        polygons:   List of polygon dicts (Mode B).  Leave None for Mode A.
        place:      Place name for Mode A spatial query.
        radius_km:  Search radius in km (Mode A, default 20, max 100).
        easting:    UTM Easting in metres (Mode A UTM coordinate mode).
        northing:   UTM Northing in metres (Mode A UTM coordinate mode).
        utm_zone:   UTM zone number (Mode A/B, default 18).
        hemisphere: "N" or "S" (Mode A/B, default "S").
    """
    # ── MODE B: explicit polygon list ──────────────────────────────────────
    if polygons:
        features = []
        errors = []
        for idx, poly in enumerate(polygons):
            if not isinstance(poly, dict):
                errors.append(f"Item {idx}: not a dict")
                continue

            name = str(poly.get("name", f"Polygon {idx + 1}")).strip()
            zone  = int(poly.get("utm_zone", utm_zone))
            hemi  = str(poly.get("hemisphere", hemisphere)).upper()
            props = dict(poly.get("properties") or {})
            props["name"] = name

            # Sub-mode B1: full GeoJSON geometry object
            geom = poly.get("geometry")

            # Sub-mode B2: plain coordinate ring
            if geom is None:
                coords = poly.get("coordinates")
                if coords and isinstance(coords, list):
                    # Close the ring if needed
                    ring = [list(c) for c in coords]
                    if ring and ring[0] != ring[-1]:
                        ring.append(ring[0])
                    geom = {"type": "Polygon", "coordinates": [ring]}

            # Sub-mode B3: UTM vertex table
            if geom is None:
                utm_verts = poly.get("utm_vertices")
                if utm_verts:
                    result = polygon_from_utm_vertices(utm_verts, zone, hemi)
                    if not result.get("ok"):
                        errors.append(f"Item {idx} ({name}): UTM conversion failed — {result.get('error')}")
                        continue
                    geom = result["geometry"]
                    props["vertex_count"] = result.get("vertex_count")
                    props["utm_zone"] = f"{zone}{hemi}"

            if geom is None:
                errors.append(f"Item {idx} ({name}): no geometry, coordinates, or utm_vertices provided")
                continue

            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": props,
            })

        if not features:
            return {"ok": False, "error": "No valid polygons found.", "details": errors}

        result = {
            "ok": True,
            "type": "FeatureCollection",
            "features": features,
            "count": len(features),
        }
        if errors:
            result["warnings"] = errors
        return result

    # ── MODE A: spatial query against GEOCATMIN dataset ────────────────────
    radius_km = max(0.5, min(float(radius_km), 100.0))

    if place:
        if "peru" not in place.lower():
            place = f"{place}, Peru"
        geo = geocode_address(place)
        if not geo.get("ok"):
            return {"ok": False, "error": geo.get("error", "Geocoding failed")}
        lat, lon = float(geo["latitude"]), float(geo["longitude"])
        place_name = geo.get("display_name", place)

    elif easting and northing:
        try:
            northern = hemisphere.upper() == "N"
            lat, lon = _utm_to_latlon(float(easting), float(northing), int(utm_zone), northern)
        except Exception as exc:
            return {"ok": False, "error": f"UTM→WGS84 conversion failed: {exc}"}
        place_name = f"UTM {utm_zone}{hemisphere} ({easting:.0f} E, {northing:.0f} N)"

    else:
        return {
            "ok": False,
            "error": (
                "Provide either a place name (place=), UTM coordinates "
                "(easting + northing), or an explicit polygon list (polygons=)."
            ),
        }

    query_result = retrieve_mining_concessions(lat, lon, radius_km)
    query_result["geo"] = {"lat": lat, "lon": lon, "place_name": place_name}
    return query_result


# ---------------------------------------------------------------------------
# Tool 3: compute_centroid
# ---------------------------------------------------------------------------
@mcp.tool()
def compute_centroid(points: list) -> dict:
    """
    Compute the geographic centroid (mean center) of a set of coordinate points.

    The centroid is the simple arithmetic mean of all latitudes and longitudes.
    Use this when the user asks for the 'center', 'middle', 'centroid', or
    'mean point' of a set of locations — for example, to find a central meeting
    point or the geographic center of a cluster of sensors/sites.

    Args:
        points: List of dicts, each with 'lat' (float) and 'lon' (float).
                Example: [{"lat": 47.009, "lon": 28.861}, {"lat": 47.013, "lon": 28.854}]

    Returns a dict with:
        ok        (bool)  : True on success
        centroid  (dict)  : {"lat": float, "lon": float} — the computed centroid
        count     (int)   : number of input points used
        geojson   (dict)  : GeoJSON FeatureCollection with a single Point feature
                            so the result can be placed on the map immediately.

    Examples (how the LLM should call this tool):
        compute_centroid([{"lat":-12.04,"lon":-77.03},{"lat":-12.05,"lon":-77.01}])
    """
    import numpy as np

    if not points:
        return {"ok": False, "error": "points list is empty"}

    coords = []
    for i, p in enumerate(points):
        if not isinstance(p, dict):
            return {"ok": False, "error": f"Item {i} is not a dict"}
        try:
            coords.append([float(p["lon"]), float(p["lat"])])
        except (KeyError, TypeError, ValueError) as exc:
            return {"ok": False, "error": f"Item {i} missing or invalid lat/lon: {exc}"}

    arr = np.array(coords)
    c_lon, c_lat = float(np.mean(arr[:, 0])), float(np.mean(arr[:, 1]))

    return {
        "ok": True,
        "centroid": {"lat": round(c_lat, 6), "lon": round(c_lon, 6)},
        "count": len(coords),
        "geojson": {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(c_lon, 6), round(c_lat, 6)]},
                "properties": {
                    "name": "Centroid",
                    "point_count": len(coords),
                    "lat": round(c_lat, 6),
                    "lon": round(c_lon, 6),
                },
            }],
        },
    }


# ---------------------------------------------------------------------------
# Tool 4: create_buffer
# ---------------------------------------------------------------------------
@mcp.tool()
def create_buffer(lat: float, lon: float, radius_km: float) -> dict:
    """
    Draw a true circular buffer around a geographic point using the
    Azimuthal Equidistant projection, which preserves distances from the
    center and produces an accurate circle (not a distorted ellipse).

    Use this when the user asks to 'draw a circle', 'create a buffer',
    'show the area within X km', or 'highlight a radius around' a point.

    Args:
        lat       (float): WGS84 latitude of the center point.
        lon       (float): WGS84 longitude of the center point.
        radius_km (float): Buffer radius in kilometres (must be > 0).

    Returns a dict with:
        ok        (bool) : True on success
        geojson   (dict) : GeoJSON FeatureCollection with the circular buffer
                           polygon, ready to render on the map.
        center    (dict) : {"lat": float, "lon": float} — the input center.
        radius_km (float): The radius used.

    Examples (how the LLM should call this tool):
        create_buffer(lat=-12.046, lon=-77.043, radius_km=5)
        create_buffer(lat=47.011, lon=28.858, radius_km=2.5)
    """
    from shapely.geometry import Point, mapping
    from shapely.ops import transform
    import pyproj

    if not (-90 <= lat <= 90):
        return {"ok": False, "error": "lat must be between -90 and 90"}
    if not (-180 <= lon <= 180):
        return {"ok": False, "error": "lon must be between -180 and 180"}
    if radius_km <= 0:
        return {"ok": False, "error": "radius_km must be > 0"}

    try:
        center = Point(lon, lat)

        # Project to Azimuthal Equidistant centered on our point (distances preserved)
        to_aeqd = pyproj.Transformer.from_crs(
            "EPSG:4326",
            f"+proj=aeqd +lat_0={lat} +lon_0={lon} +units=m",
            always_xy=True,
        ).transform
        to_wgs84 = pyproj.Transformer.from_crs(
            f"+proj=aeqd +lat_0={lat} +lon_0={lon} +units=m",
            "EPSG:4326",
            always_xy=True,
        ).transform

        buffer_polygon = transform(to_wgs84, transform(to_aeqd, center).buffer(radius_km * 1000))

        return {
            "ok": True,
            "center": {"lat": lat, "lon": lon},
            "radius_km": radius_km,
            "geojson": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {
                        "name": f"Buffer {radius_km} km",
                        "radius_km": radius_km,
                        "center_lat": lat,
                        "center_lon": lon,
                    },
                    "geometry": mapping(buffer_polygon),
                }],
            },
        }
    except Exception as exc:
        return {"ok": False, "error": f"Buffer creation failed: {exc}"}


# ---------------------------------------------------------------------------
# Tool 5: run_deep_analysis
# ---------------------------------------------------------------------------

# Panel-level explanations extracted from ANALYSIS_2_REPORT.md.
# Keyed by the filename stem (without extension) of each output HTML.
_PANEL_EXPLANATIONS: dict = {
    "01_green_infrastructure_map": (
        "Interactive map of Chisinau's green infrastructure and air quality monitoring network. "
        "Green dots represent the 9,731 mapped trees (1 in 3 shown for performance); named parks "
        "are marked with park symbols. Red circles are the 5 Sensor.Community citizen sensors; "
        "blue/grey stars are the 3 OpenAQ government stations (1 currently inactive since Aug 2024). "
        "Pan and zoom to explore the spatial distribution across the city."
    ),
    "02_green_infrastructure_breakdown": (
        "Overview of Chisinau's green element inventory. The pie chart breaks down the 8,573 "
        "mapped green areas by category — gardens dominate at ~80%. The bar chart shows absolute "
        "counts: 9,731 trees, 6,914 gardens, 1,482 grass areas, 158 parks, 56 woodland, 4 forest. "
        "Source: OpenStreetMap Overpass API (100,321 raw elements)."
    ),
    "03_tree_species_diversity": (
        "Top 15 tree species in Chisinau based on OSM tags. Only 1,547 of the 9,731 trees carry "
        "species-level data (~16% tagging coverage). Horse chestnut, Siberian elm, and black pine "
        "lead. The low tagging rate means species diversity is likely higher than shown."
    ),
    "04_tree_canopy_characteristics": (
        "Left: leaf type distribution — 84% of tagged trees are broadleaved, 15% needleleaved. "
        "Right: tree location context (denotation tag) — 85% are park trees, only 9% urban street "
        "trees. This imbalance is significant: street trees intercept vehicle-generated particulates "
        "far more effectively than park trees."
    ),
    "05_sensor_coverage_gap": (
        "Heat map showing distance to the nearest active sensor for each 500m grid cell across "
        "Chisinau. Red cells (>3 km from any sensor) represent blind spots with no air quality data. "
        "Only ~15% of the city falls within 1 km of a sensor. Large uncovered zones exist especially "
        "in the south and west quadrants."
    ),
    "06_green_density_vs_pm": (
        "Scatter plots of tree density (within 1 km) versus mean PM2.5 (left) and PM10 (right) for "
        "each of the 5 citizen sensors. The pattern is striking: sensor 42066 with 758 trees/km "
        "records PM2.5 = 2.96 µg/m³, while sensor 87968 with just 1 tree records 11.87 µg/m³ — a "
        "4× difference. Correlation, not causation (traffic density is a major confounder)."
    ),
    "07_coverage_statistics": (
        "Left pie: distribution of city area by distance band from nearest sensor. Right bar: "
        "Chisinau's 8 active stations vs WHO recommendation (~20 for 700k population), EU typical "
        "(25) and Bucharest (40). Chisinau operates at 65–80% below recommended levels."
    ),
    "08_proposed_sensor_expansion": (
        "Proposed locations for 10 new sensors (orange triangles) identified by a maximum-gap "
        "algorithm — each new site is placed at the grid cell farthest from any existing station. "
        "Adding these 10 sensors would bring the total to 17 and increase <1 km coverage from "
        "~15% to an estimated ~45% of the city area."
    ),
    "09_planting_priority_zones": (
        "Priority score for green planting by sensor zone, combining PM2.5 exposure and tree "
        "density deficit (each normalised 0–1, averaged). Zone 87968 (Central-East) scores 0.997 — "
        "worst air quality (11.87 µg/m³) and virtually no trees. Zone 42066 (NE) scores 0.072 — "
        "already well-vegetated with low pollution."
    ),
    "10_urbanization_context": (
        "Moldova's urban population share from 1990 to 2024 (World Bank indicator SP.URB.TOTL.IN.ZS). "
        "After the post-Soviet decline bottomed at 39.3% in 2010, urbanisation has been rising and "
        "reached 43.5% in 2024. This re-urbanisation trend increases pressure on Chisinau's green "
        "infrastructure and monitoring capacity."
    ),
    "11_key_metrics_dashboard": (
        "Dashboard summarising 8 headline indicators: mapped trees (9,731), green areas (8,573), "
        "active AQ stations (7), city area within 1 km of a sensor (15%), trees per 1,000 people "
        "(14), green-to-building ratio (14.5%), named parks (30+), and proposed new sensor sites (10)."
    ),
}


def _derive_panel_title(filename_stem: str) -> str:
    """Convert '01_green_infrastructure_map' → 'Green Infrastructure Map'."""
    parts = filename_stem.split("_")
    words = parts[1:]  # drop numeric prefix
    return " ".join(w.capitalize() for w in words)


@mcp.tool()
def run_deep_analysis(topic: str = "chisinau") -> dict:
    """
    Run a comprehensive geospatial analysis and return a list of visualization panels.

    Use this tool when the user asks to:
      • "make a deep analysis on [topic/city]"
      • "run a full analysis"
      • "show a detailed analysis"
      • "generate the analysis report"
      • "run the deep analysis"

    The analysis covers green infrastructure, air quality sensor coverage, tree diversity,
    urbanisation trends, sensor expansion planning, and planting priority zones.

    The tool executes the Python analysis script, writes Plotly HTML charts to disk, and
    returns metadata (file paths + explanations) so the backend can stream panels to the
    chatbot UI one at a time.

    Args:
        topic: City / analysis topic.  Only "chisinau" is currently supported.

    Returns a dict with:
        ok          (bool)  : True on success
        out_dir     (str)   : Absolute path to the directory containing HTML files
        panels      (list)  : [{ filename, title, explanation, index }]
        panel_count (int)   : Total number of panels generated
        stdout      (str)   : Script output (for debugging)
    """
    import subprocess

    chinisau_dir = os.path.join(_HERE, "data", "chinisau")
    script_path  = os.path.join(chinisau_dir, "analysis2_presentation.py")
    out_dir      = os.path.join(chinisau_dir, "output")

    if not os.path.exists(script_path):
        return {"ok": False, "error": f"Analysis script not found: {script_path}"}

    os.makedirs(out_dir, exist_ok=True)

    env = os.environ.copy()
    env["CHINISAU_DATA_ROOT"] = chinisau_dir
    env["CHINISAU_OUT_DIR"]   = out_dir

    try:
        proc = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            env=env,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Analysis script timed out after 3 minutes"}
    except Exception as exc:
        return {"ok": False, "error": f"Failed to run analysis script: {exc}"}

    if proc.returncode != 0:
        return {
            "ok": False,
            "error": f"Analysis script exited with code {proc.returncode}",
            "stderr": (proc.stderr or "")[-2000:],
            "stdout": (proc.stdout or "")[-1000:],
        }

    # Collect generated HTML files in sorted order
    import glob as _glob
    html_files = sorted(_glob.glob(os.path.join(out_dir, "*.html")))
    if not html_files:
        return {
            "ok": False,
            "error": f"Script completed but no HTML files found in {out_dir}",
            "stdout": (proc.stdout or "")[-500:],
        }

    panels = []
    for i, html_path in enumerate(html_files):
        stem = os.path.splitext(os.path.basename(html_path))[0]
        panels.append({
            "index":       i + 1,
            "filename":    os.path.basename(html_path),
            "path":        html_path,
            "title":       _derive_panel_title(stem),
            "explanation": _PANEL_EXPLANATIONS.get(stem, ""),
        })

    return {
        "ok":          True,
        "topic":       topic,
        "out_dir":     out_dir,
        "panel_count": len(panels),
        "panels":      panels,
        "stdout":      (proc.stdout or "")[-500:],
    }


if __name__ == "__main__":
    mcp.run()
