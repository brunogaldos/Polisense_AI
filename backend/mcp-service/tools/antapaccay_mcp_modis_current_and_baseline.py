from __future__ import annotations

import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import ee
except ImportError:
    ee = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODIS_COLLECTION = "MODIS/061/MOD13Q1"
MODIS_NDVI_SCALE = 0.0001
MODIS_SCALE = 250

BASELINE_SOURCE = MODIS_COLLECTION
CURRENT_SOURCE = MODIS_COLLECTION
DEFAULT_BASELINE_DATA_DIR = Path("tools/antapaccay_data/")

ANTAPACCAY_LON = -72.206
ANTAPACCAY_LAT = -14.034
ANTAPACCAY_BASELINE_RADIUS_KM = 7

STRESS_CLASS_LABELS = {
    "0": "normal_healthy",
    "1": "mild_stress",
    "2": "moderate_stress",
    "3": "severe_stress",
    "4": "extreme_stress",
}

REQUIRED_BASELINE_PROPS = ("P10", "P50", "P90")

# ---------------------------------------------------------------------------
# Process-level singleton
# ---------------------------------------------------------------------------

_EE_INITIALIZED: bool = False


# ---------------------------------------------------------------------------
# Earth Engine init
# ---------------------------------------------------------------------------


def initialize_earth_engine() -> None:
    global _EE_INITIALIZED
    if _EE_INITIALIZED:
        return

    if ee is None:
        raise RuntimeError("earthengine-api is not installed.")

    service_account = os.getenv("EE_SERVICE_ACCOUNT")
    key_json = os.getenv("EE_KEY_JSON")
    if not service_account:
        raise RuntimeError("EE_SERVICE_ACCOUNT environment variable is not set.")
    if not key_json:
        raise RuntimeError("EE_KEY_JSON environment variable is not set.")

    key_data = json.loads(key_json)
    credentials = ee.ServiceAccountCredentials(
        service_account, key_data=json.dumps(key_data)
    )
    ee.Initialize(credentials)
    _EE_INITIALIZED = True


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def make_mine_region(lon: float, lat: float, buffer_km: float) -> tuple:
    mine_center = ee.Geometry.Point([lon, lat])
    region = mine_center.buffer(buffer_km * 1_000)
    return mine_center, region, region.simplify(30)


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def validate_query_inside_precomputed_area(lon: float, lat: float, buffer_km: float) -> None:
    distance_km = _haversine_km(lon, lat, ANTAPACCAY_LON, ANTAPACCAY_LAT)
    if distance_km > ANTAPACCAY_BASELINE_RADIUS_KM + buffer_km:
        raise ValueError(
            "The requested coordinate is outside the precomputed Antapaccay "
            "baseline area."
        )


# ---------------------------------------------------------------------------
# MODIS current NDVI
# ---------------------------------------------------------------------------


def _mask_modis_qa(image: "ee.Image") -> "ee.Image":
    return image.updateMask(image.select("SummaryQA").lte(1))


def _add_modis_ndvi(image: "ee.Image") -> "ee.Image":
    return (
        image.select("NDVI")
        .multiply(MODIS_NDVI_SCALE)
        .rename("NDVI")
        .clamp(-1, 1)
        .copyProperties(image, ["system:time_start"])
    )


def make_current_monthly_ndvi(year: int, month: int, region: "ee.Geometry") -> "ee.Image":
    if not 1 <= month <= 12:
        raise ValueError("month must be between 1 and 12.")

    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, "month")

    col = (
        ee.ImageCollection(MODIS_COLLECTION)
        .filterDate(start, end)
        .filterBounds(region)
        .map(_mask_modis_qa)
        .map(_add_modis_ndvi)
        .select("NDVI")
    )

    if col.size().getInfo() == 0:
        raise ValueError(f"No MODIS images found for {year}-{month:02d}.")

    return col.median().rename("current_ndvi").clip(region)


# ---------------------------------------------------------------------------
# Precomputed baseline loading
# ---------------------------------------------------------------------------


@lru_cache(maxsize=12)
def load_precomputed_baseline(base_dir: str, month: int) -> tuple[dict, dict]:
    d = Path(base_dir).expanduser().resolve() / "baseline" / f"{month:02d}"
    geojson_path = d / "vci.geojson"
    meta_path = d / "meta.json"

    if not geojson_path.exists():
        raise FileNotFoundError(f"Baseline file not found: {geojson_path}. Run precompute_baseline.py first.")
    if not meta_path.exists():
        raise FileNotFoundError(f"Baseline metadata not found: {meta_path}.")

    baseline_geojson = json.loads(geojson_path.read_text())
    meta = json.loads(meta_path.read_text())

    features = baseline_geojson.get("features", [])
    if not features:
        raise ValueError(f"Baseline GeoJSON has no features: {geojson_path}")
    if not any(
        all((f.get("properties") or {}).get(p) is not None for p in REQUIRED_BASELINE_PROPS)
        for f in features
    ):
        raise ValueError(f"Baseline GeoJSON missing P10/P50/P90 properties: {geojson_path}")

    return baseline_geojson, meta


def _geojson_to_ee_feature_collection(baseline_geojson: dict) -> "ee.FeatureCollection":
    ee_features = []
    for feature in baseline_geojson.get("features", []):
        geometry = feature.get("geometry")
        props = feature.get("properties") or {}
        if not geometry:
            continue
        if not all(props.get(p) is not None for p in REQUIRED_BASELINE_PROPS):
            continue
        clean_props = {
            k: v for k, v in props.items()
            if v is not None and isinstance(v, (str, int, float, bool))
        }
        ee_features.append(ee.Feature(ee.Geometry(geometry), clean_props))

    if not ee_features:
        raise ValueError("No valid baseline features could be converted to Earth Engine.")
    return ee.FeatureCollection(ee_features)


def make_threshold_image(baseline_geojson: dict, region: "ee.Geometry") -> "ee.Image":
    fc = _geojson_to_ee_feature_collection(baseline_geojson).filterBounds(region)
    mask = ee.Image(0).byte().paint(fc, 1).selfMask().clip(region)

    def paint(prop: str) -> "ee.Image":
        return ee.Image(0).toFloat().paint(fc, prop).updateMask(mask).rename(prop).clip(region)

    return paint("P10").addBands(paint("P50")).addBands(paint("P90"))


# ---------------------------------------------------------------------------
# Analysis image
# ---------------------------------------------------------------------------


def build_analysis_image(
    current_ndvi: "ee.Image",
    threshold_img: "ee.Image",
    region: "ee.Geometry",
) -> "ee.Image":
    p10 = threshold_img.select("P10")
    p50 = threshold_img.select("P50")
    p90 = threshold_img.select("P90")

    robust_vci = (
        current_ndvi.subtract(p10)
        .divide(p90.subtract(p10).max(ee.Image(0.01)))
        .multiply(100)
        .clamp(0, 100)
        .rename("robust_vci")
    )

    stress_class = (
        ee.Image(0)
        .where(robust_vci.lt(50).And(robust_vci.gte(35)), 1)
        .where(robust_vci.lt(35).And(robust_vci.gte(20)), 2)
        .where(robust_vci.lt(20).And(robust_vci.gte(10)), 3)
        .where(robust_vci.lt(10), 4)
        .updateMask(robust_vci.mask())
        .rename("stress_class")
        .toUint8()
    )

    return (
        current_ndvi.rename("current_ndvi")
        .addBands(p10).addBands(p50).addBands(p90)
        .addBands(robust_vci)
        .addBands(stress_class)
        .clip(region)
    )


# ---------------------------------------------------------------------------
# Vectorisation
# ---------------------------------------------------------------------------


def _add_vector_props(
    feature: "ee.Feature",
    analysis_img: "ee.Image",
    mine_center: "ee.Geometry",
    scale: int,
) -> "ee.Feature":
    geom = feature.geometry()
    centroid = geom.centroid(1)
    coords = centroid.coordinates()

    stats = analysis_img.select(
        ["current_ndvi", "P10", "P50", "P90", "robust_vci"]
    ).reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=scale,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=8,
    )

    return feature.set(stats).set({
        "area_ha": geom.area(1).divide(10_000),
        "centroid_lon": coords.get(0),
        "centroid_lat": coords.get(1),
        "dist_mine_km": centroid.distance(mine_center, 1).divide(1_000),
        "baseline_source": BASELINE_SOURCE,
    })


def vectorize_stress_class(
    analysis_img: "ee.Image",
    region: "ee.Geometry",
    mine_center: "ee.Geometry",
    scale: int,
    max_features: int,
) -> "ee.FeatureCollection":
    vectors = analysis_img.select("stress_class").reduceToVectors(
        geometry=region,
        scale=scale,
        geometryType="polygon",
        eightConnected=True,
        labelProperty="stress_class",
        reducer=ee.Reducer.countEvery(),
        maxPixels=1e13,
        bestEffort=True,
        tileScale=16,
    )

    label_ee = ee.Dictionary(STRESS_CLASS_LABELS)

    def add_props(feature):
        class_value = ee.Number(feature.get("stress_class")).toInt()
        class_name = label_ee.get(class_value.format())
        return _add_vector_props(
            feature.set({"class_name": class_name}), analysis_img, mine_center, scale
        )

    return vectors.map(add_props).sort("area_ha", False).limit(max_features)


def _clean_geojson_features(geojson: dict) -> dict:
    for feature in geojson.get("features") or []:
        if isinstance(feature.get("geometry"), dict):
            feature["geometry"].pop("geodesic", None)
        props = feature.get("properties")
        if isinstance(props, dict):
            props.pop("count", None)
    return geojson

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def generate_mine_ndvi_geojson(
    lon: float,
    lat: float,
    year: int,
    month: int,
    mine_name: str = "antapaccay",
    buffer_km: float = 7.0,
    baseline_data_dir: str = DEFAULT_BASELINE_DATA_DIR,
    scale: int = MODIS_SCALE,
    max_features: int = 1_000,
) -> dict:
    """
    Generate stress class GeoJSON for current vegetation stress around Antapaccay.

    Uses precomputed monthly MODIS baseline files (P10/P50/P90) from disk.
    Compares current MODIS NDVI against those thresholds to classify stress.

    Args:
        lon, lat: Query coordinate within the Antapaccay baseline area.
        year, month: Month to analyse from MODIS.
        mine_name: Label for this mine in the output.
        buffer_km: Analysis radius around the coordinate.
        baseline_data_dir: Directory containing baseline/<MM>/vci.geojson and meta.json.
        scale: Vectorisation scale in meters. 250 = native MODIS resolution.
        max_features: Maximum polygons returned.
    """
    initialize_earth_engine()
    validate_query_inside_precomputed_area(lon, lat, buffer_km)

    mine_center, region, region_simple = make_mine_region(lon, lat, buffer_km)

    baseline_geojson, baseline_meta = load_precomputed_baseline(
        str(baseline_data_dir), month
        )
    threshold_img = make_threshold_image(baseline_geojson, region)
    
    current_ndvi = make_current_monthly_ndvi(year, month, region)
    analysis_img = build_analysis_image(current_ndvi, threshold_img, region_simple)

    stress_geojson = vectorize_stress_class(
        analysis_img, region_simple, mine_center, scale, max_features
    ).getInfo()
    stress_geojson = _clean_geojson_features(stress_geojson)
    if not isinstance(stress_geojson, dict) or stress_geojson.get("type") != "FeatureCollection":
        raise ValueError("Stress class layer is not a valid GeoJSON FeatureCollection.")
    if not stress_geojson.get("features"):
        raise ValueError("Stress class layer has no renderable features.")
    return {
        "ok": True,
        "mine_name": mine_name,
        "year": year,
        "month": month,
        "buffer_km": buffer_km,
        "baseline_start": baseline_meta.get("baseline_start"),
        "baseline_end": baseline_meta.get("baseline_end"),
        "baseline_source": baseline_meta.get("baseline_source"),
        "current_source": CURRENT_SOURCE,
        "scale": scale,
        "layers": {
            "stress_class": stress_geojson,
        },
        "feature_counts": {
            "stress_class": len(stress_geojson.get("features", [])),
        },
    }