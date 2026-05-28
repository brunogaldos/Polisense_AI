"""
polygon_from_document.py

Converts a list of UTM (Universal Transverse Mercator) vertices — extracted from
a PDF document's UTM coordinate table — into a GeoJSON Polygon (WGS84 / EPSG:4326).

UTM → WGS84 conversion uses the standard Transverse Mercator inverse equations
with WGS84 ellipsoid parameters (Snyder 1987, Professional Paper 1395).
No pyproj or other C-extension dependency is required.
"""

import math
from typing import Any, Dict, List

# ── WGS84 ellipsoid ──────────────────────────────────────────────────────────
_A  = 6_378_137.0            # semi-major axis (m)
_F  = 1.0 / 298.257_223_563  # flattening
_E2 = 2 * _F - _F ** 2       # first eccentricity squared (e²)
_E  = math.sqrt(_E2)

# UTM scale factor and false easting
_K0 = 0.9996
_E0 = 500_000.0              # false easting (m)
# False northing: 10 000 000 m for Southern Hemisphere, 0 for Northern


def _utm_to_latlon(
    easting: float,
    northing: float,
    zone: int,
    northern: bool,
) -> tuple[float, float]:
    """
    Convert UTM easting/northing to WGS84 latitude/longitude (degrees).

    Implements the Transverse Mercator inverse formulas from
    Snyder (1987) Professional Paper 1395, §8.

    Args:
        easting:  UTM easting in metres, with false easting already applied.
        northing: UTM northing in metres, with false northing already applied.
        zone:     UTM zone number (1–60).
        northern: True for Northern Hemisphere, False for Southern.

    Returns:
        (latitude_deg, longitude_deg)
    """
    x = easting - _E0
    y = northing if northern else northing - 10_000_000.0

    M = y / _K0

    # Footprint latitude (µ) — meridional arc inverse
    mu = M / (_A * (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256))

    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * math.sin(8 * mu)
    )

    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)

    N1 = _A / math.sqrt(1 - _E2 * sin_phi1 ** 2)
    T1 = tan_phi1 ** 2
    C1 = (_E2 / (1 - _E2)) * cos_phi1 ** 2
    R1 = _A * (1 - _E2) / (1 - _E2 * sin_phi1 ** 2) ** 1.5
    D  = x / (N1 * _K0)

    lat = phi1 - (N1 * tan_phi1 / R1) * (
        D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * _E2 / (1 - _E2)) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * _E2 / (1 - _E2) - 3 * C1 ** 2)
        * D ** 6 / 720
    )

    # Central meridian of zone (degrees)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    lon = lon0 + (
        D
        - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * _E2 / (1 - _E2) + 24 * T1 ** 2)
        * D ** 5 / 120
    ) / cos_phi1

    return math.degrees(lat), math.degrees(lon)


def polygon_from_utm_vertices(
    vertices: List[Dict[str, Any]],
    utm_zone: int = 18,
    hemisphere: str = "S",
) -> Dict[str, Any]:
    """
    Convert a list of UTM vertex dicts into a GeoJSON Polygon (WGS84).

    Each vertex dict must contain:
        vertex   – label, e.g. "V-1" (informational only)
        easting  – UTM Easting in metres, as float or numeric string
        northing – UTM Northing in metres, as float or numeric string

    Args:
        vertices:   Ordered list of vertex dicts (the polygon ring order matters).
        utm_zone:   UTM zone number (default 18 — western/central Peru).
        hemisphere: "N" (northern) or "S" (southern, default — Peru).

    Returns:
        dict with:
            ok           – True on success
            geometry     – GeoJSON Polygon object {"type":"Polygon","coordinates":[[...]]}
            vertex_count – number of unique vertices
        or on failure:
            ok    – False
            error – error description string
    """
    if not vertices:
        return {"ok": False, "error": "No vertices provided"}

    northern = hemisphere.upper() == "N"
    coords: List[List[float]] = []

    for i, v in enumerate(vertices):
        try:
            easting  = float(str(v.get("easting",  v.get("este_x",  v.get("este", v.get("x", ""))))).replace(",", ""))
            northing = float(str(v.get("northing", v.get("norte_y", v.get("norte", v.get("y", ""))))).replace(",", ""))
        except (ValueError, TypeError) as exc:
            return {"ok": False, "error": f"Invalid vertex data at index {i}: {exc}  — got {v}"}

        try:
            lat, lon = _utm_to_latlon(easting, northing, utm_zone, northern)
        except Exception as exc:
            return {"ok": False, "error": f"UTM→WGS84 conversion failed at index {i}: {exc}"}

        coords.append([round(lon, 8), round(lat, 8)])

    # Close the GeoJSON ring (first point == last point)
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])

    return {
        "ok": True,
        "vertex_count": len(vertices),
        "geometry": {
            "type": "Polygon",
            "coordinates": [coords],
        },
    }
