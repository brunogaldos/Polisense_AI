"""Pure geo/UTM helpers — ports of the math/parsing methods on
skillsFirstChatBotFirestore.ts (no chatbot state involved).
"""

import math
import re
from typing import Any, Optional


def _parse_float_prefix(s: str) -> float:
    """JS parseFloat parity: parse the longest valid float prefix, NaN otherwise."""
    m = re.match(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s.strip())
    return float(m.group(0)) if m else float("nan")


def number_locale_for_lang(lang: str) -> str:
    return "es-PE" if lang == "es" else "en-US"


def format_int_locale(n: float, lang: str) -> str:
    """Thousands-grouped integer in the user's locale (es → '.', en → ',')."""
    grouped = f"{round(n):,}"
    return grouped.replace(",", ".") if lang == "es" else grouped


def extract_utm_zone(text: str) -> tuple[int, str]:
    """Recognise 'Zona 18S', 'WGS84 ZONA 19 S', 'Huso 18', etc. Defaults 18/S."""
    m = re.search(r"(?:zona|zone|huso)\s*(\d{1,2})\s*([NS])?", text, re.IGNORECASE)
    if m:
        return int(m.group(1)), (m.group(2) or "S").upper()
    return 18, "S"


def extract_utm_vertices(text: str) -> Optional[list[dict[str, Any]]]:
    """Extract UTM vertex rows from PDF markdown or chat text. Narrows to the
    UTM coordinate table heading when present. Peru plausibility filter:
    easting 100k–900k m, northing 7M–10M m. Needs ≥3 vertices to be valid."""
    # Match the Spanish heading used in Peruvian mining documents
    heading = re.search(r"CUADRO\s+DE\s+COORDENADAS\s+UTM", text, re.IGNORECASE)
    search_text = text[heading.start() : heading.start() + 3000] if heading else text

    vertices: list[dict[str, Any]] = []

    # Strategy 1 — pipe table: | V-1 | 276500.00 | 8234500.00 |
    pipe_re = re.compile(r"\|\s*([^\|]+?)\s*\|\s*([\d\s.,]+)\s*\|\s*([\d\s.,]+)\s*\|")
    for m in pipe_re.finditer(search_text):
        label = m.group(1).strip()
        if re.search(r"[a-zA-ZÀ-ÿ]{3,}", label):
            continue  # skip header rows
        e_x = _parse_float_prefix(re.sub(r"\s", "", m.group(2)).replace(",", ".", 1))
        n_y = _parse_float_prefix(re.sub(r"\s", "", m.group(3)).replace(",", ".", 1))
        if not math.isnan(e_x) and not math.isnan(n_y) and 100_000 < e_x < 900_000 and 7_000_000 < n_y < 10_000_000:
            vertices.append({"vertex": label, "easting": e_x, "northing": n_y})
    if len(vertices) >= 3:
        return vertices

    # Strategy 2 — whitespace/tab separated: V-1  276500.00  8234500.00
    for line in search_text.split("\n"):
        cols = re.split(r"\s{2,}|\t", line.strip())
        if len(cols) < 3:
            continue
        e_x = _parse_float_prefix(cols[1].replace(",", ".", 1))
        n_y = _parse_float_prefix(cols[2].replace(",", ".", 1))
        if not math.isnan(e_x) and not math.isnan(n_y) and 100_000 < e_x < 900_000 and 7_000_000 < n_y < 10_000_000:
            vertices.append({"vertex": cols[0].strip(), "easting": e_x, "northing": n_y})
    return vertices if len(vertices) >= 3 else None


def flat_geo_coords(coords: Any) -> list[list[float]]:
    """Flatten all leaf [lng, lat] pairs from any GeoJSON coordinates array."""
    if not isinstance(coords, list):
        return []
    if coords and isinstance(coords[0], (int, float)):
        return [[coords[0], coords[1]]]
    out: list[list[float]] = []
    for c in coords:
        out.extend(flat_geo_coords(c))
    return out


def feature_centroid(geometry: Any) -> Optional[list[float]]:
    """[lng, lat] centroid for a GeoJSON geometry, or None."""
    try:
        if not geometry:
            return None
        if geometry.get("type") == "Point":
            c = geometry["coordinates"]
            return [c[0], c[1]]
        pts = flat_geo_coords(geometry.get("coordinates"))
        if not pts:
            return None
        sum_lng = sum(p[0] for p in pts)
        sum_lat = sum(p[1] for p in pts)
        return [round(sum_lng / len(pts), 6), round(sum_lat / len(pts), 6)]
    except (KeyError, TypeError, IndexError):
        return None


def lat_lon_to_utm(lat_deg: float, lon_deg: float, zone: int, northern: bool) -> tuple[float, float]:
    """WGS84 lat/lon → UTM easting/northing (Snyder 1987 forward TM)."""
    a = 6_378_137.0
    f = 1.0 / 298.257_223_563
    e2 = 2 * f - f * f
    k0 = 0.9996
    e0 = 500_000.0
    n0 = 0 if northern else 10_000_000.0

    lat = lat_deg * math.pi / 180
    lon = lon_deg * math.pi / 180
    lon0 = ((zone - 1) * 6 - 180 + 3) * math.pi / 180

    sin_lat, cos_lat, tan_lat = math.sin(lat), math.cos(lat), math.tan(lat)
    n = a / math.sqrt(1 - e2 * sin_lat**2)
    t = tan_lat**2
    c = (e2 / (1 - e2)) * cos_lat**2
    aa = cos_lat * (lon - lon0)
    ep2 = e2 / (1 - e2)

    e4, e6 = e2 * e2, e2 * e2 * e2
    m = a * (
        (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * lat)
        + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * lat)
        - (35 * e6 / 3072) * math.sin(6 * lat)
    )

    easting = e0 + k0 * n * (
        aa + (1 - t + c) * aa**3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa**5 / 120
    )
    northing = n0 + k0 * (
        m
        + n * tan_lat * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c * c) * aa**4 / 24
            + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return easting, northing
