import json
import math
import os
from typing import Any, Dict, List, Optional, Tuple

from shapely.geometry import Polygon, mapping, shape

# ──────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
# data/ lives one level up (mcp-service/data/), not inside tools/
_GEOJSON_PATH = os.path.join(_HERE, "..", "data", "Catastro.geojson")

# ──────────────────────────────────────────────────────────────
# Azimuthal Equidistant buffer in WGS84 (no pyproj required)
# ──────────────────────────────────────────────────────────────
_R_EARTH = 6_371_000.0  # mean Earth radius (m)


def _ae_inverse(x_m: float, y_m: float, lat0_rad: float, lon0_rad: float) -> Tuple[float, float]:
    """Inverse AE projection: AE metres → (lat_rad, lon_rad).

    Snyder (1987) §25 inverse equations.  x and y must be normalised by R
    before substituting into the angle formulas; c is the angular distance.
    """
    xn = x_m / _R_EARTH
    yn = y_m / _R_EARTH
    c = math.sqrt(xn**2 + yn**2)
    if c < 1e-10:
        return lat0_rad, lon0_rad
    arg = math.cos(c) * math.sin(lat0_rad) + yn * math.sin(c) * math.cos(lat0_rad) / c
    lat = math.asin(max(-1.0, min(1.0, arg)))
    lon = lon0_rad + math.atan2(
        xn * math.sin(c),
        c * math.cos(lat0_rad) * math.cos(c) - yn * math.sin(lat0_rad) * math.sin(c),
    )
    return lat, lon


def _ae_buffer_wgs84(
    lat_deg: float, lon_deg: float, radius_km: float, n_points: int = 64
) -> List[List[float]]:
    """
    Create a true circular buffer using AE projection.
    Returns a closed ring of [lon, lat] pairs (GeoJSON order).
    """
    lat0 = math.radians(lat_deg)
    lon0 = math.radians(lon_deg)
    r_m  = radius_km * 1000.0
    ring = []
    for i in range(n_points):
        angle = 2 * math.pi * i / n_points
        lat_r, lon_r = _ae_inverse(r_m * math.cos(angle), r_m * math.sin(angle), lat0, lon0)
        ring.append([math.degrees(lon_r), math.degrees(lat_r)])
    ring.append(ring[0])  # close ring
    return ring


# ──────────────────────────────────────────────────────────────
# GeoJSON loading — coordinates already in WGS84
# ──────────────────────────────────────────────────────────────
_cached_features: Optional[List[Tuple[Any, dict]]] = None  # (shapely_geom, attrs)


def _load_features() -> List[Tuple[Any, dict]]:
    """
    Lazy-load and cache all GeoJSON features.
    Coordinates are already in WGS84 — no reprojection needed.
    Returns list of (shapely_geometry, attribute_dict).
    """
    global _cached_features
    if _cached_features is not None:
        return _cached_features

    if not os.path.exists(_GEOJSON_PATH):
        raise FileNotFoundError(f"GEOCATMIN GeoJSON not found at:\n  {_GEOJSON_PATH}")

    with open(_GEOJSON_PATH, encoding="utf-8") as f:
        collection = json.load(f)

    features: List[Tuple[Any, dict]] = []
    for feat in collection.get("features", []):
        try:
            geom = shape(feat["geometry"])
            if not geom.is_valid:
                geom = geom.buffer(0)  # attempt topology repair
        except Exception:
            continue
        attrs: dict = {
            k: (str(v) if v is not None else "")
            for k, v in feat.get("properties", {}).items()
        }
        features.append((geom, attrs))

    _cached_features = features
    return _cached_features


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

def retrieve_mining_concessions(
    latitude: float,
    longitude: float,
    radius_km: float,
) -> Dict[str, Any]:
    """
    Find GEOCATMIN mining concessions within radius_km of (latitude, longitude).

    Creates a true circular buffer using Azimuthal Equidistant projection and
    returns all concessions from data/Catastro.geojson that spatially intersect it.

    Returns:
        dict with keys:
          ok       - True on success
          features - list of GeoJSON Feature dicts (Polygon geometries, WGS84)
          buffer   - GeoJSON Polygon of the search buffer (for map display)
          type     - "FeatureCollection"
    """
    if not (-90 <= latitude <= 90):
        return {"ok": False, "error": "Invalid latitude"}
    if not (-180 <= longitude <= 180):
        return {"ok": False, "error": "Invalid longitude"}
    if radius_km <= 0:
        return {"ok": False, "error": "radius_km must be > 0"}

    try:
        ring = _ae_buffer_wgs84(latitude, longitude, radius_km)
        buffer_poly = Polygon(ring)

        all_features = _load_features()

        matched: List[Dict[str, Any]] = []
        for geom, attrs in all_features:
            try:
                if geom.intersects(buffer_poly):
                    matched.append({
                        "type": "Feature",
                        "geometry": mapping(geom),
                        "properties": attrs,
                    })
            except Exception:
                continue

        return {
            "ok": True,
            "type": "FeatureCollection",
            "features": matched,
            "buffer": {
                "type": "Polygon",
                "coordinates": [ring],
            },
        }

    except FileNotFoundError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Mining concession query failed: {exc}"}
