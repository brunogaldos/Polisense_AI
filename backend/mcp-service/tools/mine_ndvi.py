from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from typing import Optional

try:
    import ee
except ImportError:
    ee = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"
S2_SCALE = 10_000.0
MAX_CLOUD_PCT = 60
PERCENTILES = [10, 25, 50, 75, 90]

# Bad SCL classes: saturated, dark area, cloud shadow, water, unclassified,
# medium/high-prob cloud, cirrus, snow/ice
SCL_BAD_VALUES = [0, 1, 2, 3, 7, 8, 9, 10, 11]

DEFAULT_BASELINE_START = "2019-01-01"
DEFAULT_BASELINE_END = "2020-12-31"

STRESS_CLASS_LABELS = {
    "0": "normal_healthy",
    "1": "mild_stress",
    "2": "moderate_stress",
    "3": "severe_stress",
    "4": "extreme_stress",
}
ANOMALY_CLASS_LABELS = {
    "0": "strong_negative",
    "1": "negative",
    "2": "near_normal",
    "3": "positive",
    "4": "strong_positive",
}
VCI_CLASS_LABELS = {
    "0": "very_low_vci",
    "1": "low_vci",
    "2": "moderate_vci",
    "3": "healthy_vci",
    "4": "very_healthy_vci",
}

# ---------------------------------------------------------------------------
# Process-level singletons (built once, reused across tool calls)
# ---------------------------------------------------------------------------

_EE_INITIALIZED: bool = False

# ee.List object for the SCL bad-value mask — constructed after init
_SCL_BAD_EE: Optional[object] = None  # ee.List


def initialize_earth_engine() -> None:
    """
    Idempotent EE initializer.

    Calling this multiple times in the same process is free after the first
    call.  The MCP runtime may call the tool many times in one session; we
    must not re-authenticate on every invocation.
    """
    global _EE_INITIALIZED, _SCL_BAD_EE
    if _EE_INITIALIZED:
        return

    if ee is None:
        raise RuntimeError(
            "earthengine-api is not installed. "
            "Install backend/mcp-service/requirements.txt before using NDVI tools."
        )

    project = os.getenv("EE_PROJECT")
    service_account = os.getenv("EE_SERVICE_ACCOUNT")
    key_json = os.getenv("EE_KEY_JSON")
    if not key_json:
        raise RuntimeError("EE_KEY_JSON environment variable is not set.")

    key_data = json.loads(key_json)
    credentials = ee.ServiceAccountCredentials(
        service_account, key_data=json.dumps(key_data)
    )
    ee.Initialize(credentials)

    # Build the SCL bad-value ee.List once — reused in every mapped image call
    _SCL_BAD_EE = ee.List(SCL_BAD_VALUES)
    _EE_INITIALIZED = True


# ---------------------------------------------------------------------------
# EE geometry helpers
# ---------------------------------------------------------------------------


def make_mine_region(
    lon: float, lat: float, buffer_km: float
) -> tuple:
    """Return (mine_center Point, full buffer, simplified buffer)."""
    mine_center = ee.Geometry.Point([lon, lat])
    region = mine_center.buffer(buffer_km * 1_000)
    # simplify(30) reduces vertex count → faster reduceToVectors
    return mine_center, region, region.simplify(30)


# ---------------------------------------------------------------------------
# Sentinel-2 NDVI pipeline
# ---------------------------------------------------------------------------


def _mask_s2_clouds_scl(image: "ee.Image") -> "ee.Image":
    """
    SCL-based cloud mask using a single inList operation.

    Original used a chain of .neq().And() — O(n) server-side ops.
    ee.Image.remap / inList evaluates as a single lookup table op.
    """
    scl = image.select("SCL")
    # pixelIsGood = 1 where SCL value is NOT in the bad list
    good = scl.remap(
        _SCL_BAD_EE,                           # from: bad values
        ee.List.repeat(0, len(SCL_BAD_VALUES)), # to:   0
        defaultValue=1,                         # everything else → 1
    ).selfMask()
    return image.updateMask(good)


def _add_s2_ndvi(image: "ee.Image") -> "ee.Image":
    """Compute NDVI and attach date properties."""
    red = image.select("B4").toFloat().divide(S2_SCALE)
    nir = image.select("B8").toFloat().divide(S2_SCALE)
    ndvi = nir.subtract(red).divide(nir.add(red)).rename("NDVI")
    return (
        ndvi.clamp(-1, 1)
        .copyProperties(image, ["system:time_start"])
        .set("year", image.date().get("year"))
        .set("month", image.date().get("month"))
        .set("date", image.date().format("YYYY-MM-dd"))
    )


def _build_s2_ndvi_collection(
    start_date, end_date, region: "ee.Geometry"
) -> "ee.ImageCollection":
    return (
        ee.ImageCollection(S2_COLLECTION)
        .filterDate(start_date, end_date)
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", MAX_CLOUD_PCT))
        .map(_mask_s2_clouds_scl)
        .map(_add_s2_ndvi)
        .select("NDVI")
    )


# ---------------------------------------------------------------------------
# Baseline threshold — memoised to avoid re-fetching for identical params
# ---------------------------------------------------------------------------


@lru_cache(maxsize=64)
def _cached_monthly_threshold(
    month: int,
    region_wkt: str,  # JSON string of region — hashable cache key
    baseline_start: str,
    baseline_end: str,
) -> "ee.Image":
    """
    Build & return the P10/P25/P50/P75/P90 threshold image for a given month.

    Decorated with lru_cache so that repeated tool calls for the same mine /
    month / baseline reuse the already-built EE computation graph without
    issuing redundant .getInfo() count checks.

    NOTE: ee.Image objects returned here are lazy EE graph nodes — caching them
    is safe and free.  The heavy work (actual pixel computation) only runs when
    .getInfo() / .reduceToVectors() is called downstream.
    """
    region = ee.Geometry(json.loads(region_wkt))
    baseline_col = _build_s2_ndvi_collection(baseline_start, baseline_end, region)
    month_col = baseline_col.filter(ee.Filter.calendarRange(month, month, "month"))

    # Single .size().getInfo() is unavoidable to guard against empty collections.
    # It is the only blocking call in the build phase.
    if month_col.size().getInfo() == 0:
        raise ValueError(
            f"No baseline Sentinel-2 images found for month={month}."
        )

    return (
        month_col
        .reduce(ee.Reducer.percentile(PERCENTILES))
        .rename([f"P{p}" for p in PERCENTILES])
        .clip(region)
    )


def make_monthly_threshold(
    month: int,
    region: "ee.Geometry",
    baseline_start: str,
    baseline_end: str,
) -> "ee.Image":
    """Public wrapper that converts region to a hashable key for the cache."""
    region_wkt = json.dumps(region.getInfo())
    return _cached_monthly_threshold(month, region_wkt, baseline_start, baseline_end)


def make_current_monthly_ndvi(
    year: int, month: int, region: "ee.Geometry"
) -> "ee.Image":
    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, "month")
    current_col = _build_s2_ndvi_collection(start, end, region)

    if current_col.size().getInfo() == 0:
        raise ValueError(
            f"No Sentinel-2 images found for {year}-{month:02d}."
        )

    return (
        current_col.median()
        .rename("current_ndvi")
        .clip(region)
        .set("year", year)
        .set("month", month)
    )


# ---------------------------------------------------------------------------
# Stress / anomaly / VCI computation — single fused band stack
# ---------------------------------------------------------------------------


def build_full_analysis_image(
    current_ndvi: "ee.Image",
    threshold_img: "ee.Image",
    region: "ee.Geometry",
) -> "ee.Image":
    """
    Compute ALL derived bands in one fused image.

    Original built stress_result, then called classify_anomaly and classify_vci
    as separate image operations.  Here everything is stacked once so that
    downstream vectorize calls share one tile-cache entry.

    Bands produced:
      current_ndvi, P10, P25, P50, P75, P90,
      ndvi_anomaly, robust_vci, severity,
      stress_class (uint8),
      anomaly_class (uint8),
      vci_class (uint8),
      severe_extreme (uint8, masked)
    """
    p10 = threshold_img.select("P10")
    p25 = threshold_img.select("P25")
    p50 = threshold_img.select("P50")
    p75 = threshold_img.select("P75")
    p90 = threshold_img.select("P90")

    ndvi_anomaly = current_ndvi.subtract(p50).rename("ndvi_anomaly")

    robust_vci = (
        current_ndvi.subtract(p10)
        .divide(p90.subtract(p10).max(ee.Image(0.01)))
        .multiply(100)
        .clamp(0, 100)
        .rename("robust_vci")
    )
    severity = (
        ee.Image(1).subtract(robust_vci.divide(100))
        .clamp(0, 1)
        .rename("severity")
    )

    # --- stress_class ---
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

    # --- anomaly_class ---
    anomaly_class = (
        ee.Image(2)
        .where(ndvi_anomaly.lt(-0.20), 0)
        .where(ndvi_anomaly.gte(-0.20).And(ndvi_anomaly.lt(-0.08)), 1)
        .where(ndvi_anomaly.gte(0.08).And(ndvi_anomaly.lt(0.20)), 3)
        .where(ndvi_anomaly.gte(0.20), 4)
        .updateMask(ndvi_anomaly.mask())
        .rename("anomaly_class")
        .toUint8()
    )

    # --- vci_class ---
    vci_class = (
        ee.Image(2)
        .where(robust_vci.lt(20), 0)
        .where(robust_vci.gte(20).And(robust_vci.lt(35)), 1)
        .where(robust_vci.gte(50).And(robust_vci.lt(75)), 3)
        .where(robust_vci.gte(75), 4)
        .updateMask(robust_vci.mask())
        .rename("vci_class")
        .toUint8()
    )

    # --- severe_extreme mask ---
    severe_extreme = (
        stress_class.gte(3).selfMask().rename("severe_extreme").toUint8()
    )

    # Stack everything — clip once here, nowhere else
    return (
        current_ndvi.rename("current_ndvi")
        .addBands(p10.rename("P10"))
        .addBands(p25.rename("P25"))
        .addBands(p50.rename("P50"))
        .addBands(p75.rename("P75"))
        .addBands(p90.rename("P90"))
        .addBands(ndvi_anomaly)
        .addBands(robust_vci)
        .addBands(severity)
        .addBands(stress_class)
        .addBands(anomaly_class)
        .addBands(vci_class)
        .addBands(severe_extreme)
        .clip(region)  # single clip for the entire stack
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
    """
    Attach mean NDVI stats + area / centroid / distance to each polygon feature.

    Only five bands are reduced — avoids pulling all 13 bands through
    reduceRegion unnecessarily.
    """
    geom = feature.geometry()
    centroid = geom.centroid(1)
    coords = centroid.coordinates()

    stats = analysis_img.select(
        ["current_ndvi", "P50", "ndvi_anomaly", "robust_vci", "severity"]
    ).reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=scale,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=8,
    )
    return feature.set(stats).set(
        {
            "area_ha": geom.area(1).divide(10_000),
            "centroid_lon": coords.get(0),
            "centroid_lat": coords.get(1),
            "dist_mine_km": centroid.distance(mine_center, 1).divide(1_000),
        }
    )


def vectorize_band(
    analysis_img: "ee.Image",
    class_band: str,
    label_lookup: dict,
    region: "ee.Geometry",
    mine_center: "ee.Geometry",
    scale: int,
    min_area_ha: float = 0.0,
    max_features: int = 5_000,
) -> "ee.FeatureCollection":
    """
    Vectorise one class band from the fused analysis image.

    Pulls the band from the shared multi-band image so EE can reuse cached
    tiles for the shared source pixels.
    """
    class_img = analysis_img.select(class_band)

    vectors = class_img.reduceToVectors(
        geometry=region,
        scale=scale,
        geometryType="polygon",
        eightConnected=True,
        labelProperty=class_band,
        reducer=ee.Reducer.countEvery(),
        maxPixels=1e13,
        bestEffort=True,
        tileScale=16,
    )

    label_ee = ee.Dictionary(label_lookup)

    def add_props(feature):
        class_value = ee.Number(feature.get(class_band)).toInt()
        class_name = label_ee.get(class_value.format())
        return _add_vector_props(
            feature.set({"class_name": class_name}),
            analysis_img,
            mine_center,
            scale,
        )

    vectors = vectors.map(add_props)

    if min_area_ha > 0:
        vectors = vectors.filter(ee.Filter.gte("area_ha", min_area_ha))

    return vectors.sort("area_ha", False).limit(max_features)


# ---------------------------------------------------------------------------
# Main GeoJSON builder — parallel layer export
# ---------------------------------------------------------------------------


def build_geojson_layers(
    lon: float,
    lat: float,
    year: int,
    month: int,
    buffer_km: float = 7.0,
    baseline_start: str = DEFAULT_BASELINE_START,
    baseline_end: str = DEFAULT_BASELINE_END,
    scale: int = 30,
    min_patch_ha: float = 5.0,
    max_features: int = 1_000,
) -> dict:
    """
    Build all six GeoJSON layers and materialise them in parallel.

    The EE computation graph (build_full_analysis_image) is constructed once
    on the Python side.  The six .getInfo() calls — which are the real network
    round-trips — are issued concurrently via a thread pool so their latency
    overlaps instead of summing.

    On a typical mine AOI this cuts wall-clock time from ~6 × T_layer to
    roughly max(T_layer) + thread overhead, often a 3-4× speedup.
    """
    mine_center, region, region_simple = make_mine_region(lon, lat, buffer_km)

    # Two blocking calls needed before graph construction
    threshold_img = make_monthly_threshold(month, region, baseline_start, baseline_end)
    current_ndvi = make_current_monthly_ndvi(year, month, region)

    # Build the single fused image — no .getInfo() here, pure graph construction
    analysis_img = build_full_analysis_image(current_ndvi, threshold_img, region_simple)

    # Define the six layer specs
    layer_specs = {
        "anomaly": dict(
            class_band="anomaly_class",
            label_lookup=ANOMALY_CLASS_LABELS,
            min_area_ha=0.0,
        ),
        "vci": dict(
            class_band="vci_class",
            label_lookup=VCI_CLASS_LABELS,
            min_area_ha=0.0,
        ),
        "stress_class": dict(
            class_band="stress_class",
            label_lookup=STRESS_CLASS_LABELS,
            min_area_ha=0.0,
        ),
        "severe_extreme": dict(
            class_band="severe_extreme",
            label_lookup={"1": "severe_or_extreme_stress"},
            min_area_ha=min_patch_ha,
        ),
    }

    # Simple point / buffer layers — cheap, done synchronously
    static_layers = {
        "mine_point": ee.FeatureCollection(
            [ee.Feature(mine_center, {"layer": "mine_point", "lon": lon, "lat": lat})]
        ).getInfo(),
        "buffer": ee.FeatureCollection(
            [ee.Feature(region_simple, {"layer": "buffer", "buffer_km": buffer_km})]
        ).getInfo(),
    }

    # Build all four FeatureCollection graph nodes (no network yet)
    fc_nodes = {
        name: vectorize_band(
            analysis_img=analysis_img,
            region=region_simple,
            mine_center=mine_center,
            scale=scale,
            max_features=max_features,
            **spec,
        )
        for name, spec in layer_specs.items()
    }

    # Materialise all four in parallel — each .getInfo() is a separate HTTP call
    results: dict = dict(static_layers)

    def _fetch(name: str, fc: "ee.FeatureCollection") -> tuple[str, dict]:
        return name, fc.getInfo()

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_fetch, name, fc): name for name, fc in fc_nodes.items()}
        for future in as_completed(futures):
            name, geojson = future.result()  # raises on EE error → caller sees it
            results[name] = geojson

    return results


# ---------------------------------------------------------------------------
# Public MCP tool entry point
# ---------------------------------------------------------------------------


def generate_mine_ndvi_geojson(
    lon: float,
    lat: float,
    year: int,
    month: int,
    mine_name: str = "mine",
    buffer_km: float = 7.0,
    baseline_start: str = DEFAULT_BASELINE_START,
    baseline_end: str = DEFAULT_BASELINE_END,
    scale: int = 30,
    min_patch_ha: float = 5.0,
    max_features: int = 1_000,
) -> dict:
    """
    Generate Mapbox-ready GeoJSON layers for mine-area vegetation stress.

    Returns a dict with keys:
      mine_name, lon, lat, year, month, buffer_km,
      baseline_start, baseline_end, scale,
      layers        — dict of six GeoJSON FeatureCollections
      feature_counts — layer-name → feature count

    Performance notes for callers
    --------------------------------
    * scale=30 is fine for production.  Set scale=60 or scale=100 for fast
      previews / chatbot quick-answers — halving scale quarters pixel count.
    * max_features=200 is sufficient for most summary responses; use 1000+ only
      when the user asks for full spatial export.
    * buffer_km=5 is usually enough for impact-radius queries; larger values
      increase EE compute time super-linearly.
    * The baseline threshold image is memoised per (month, region, start, end)
      tuple, so repeated queries for the same mine in the same month cost only
      the current-NDVI + vectorisation round-trips.
    """
    initialize_earth_engine()  # idempotent — free after first call

    layers = build_geojson_layers(
        lon=lon,
        lat=lat,
        year=year,
        month=month,
        buffer_km=buffer_km,
        baseline_start=baseline_start,
        baseline_end=baseline_end,
        scale=scale,
        min_patch_ha=min_patch_ha,
        max_features=max_features,
    )

    return {
        "mine_name": mine_name,
        "lon": lon,
        "lat": lat,
        "year": year,
        "month": month,
        "buffer_km": buffer_km,
        "baseline_start": baseline_start,
        "baseline_end": baseline_end,
        "scale": scale,
        "layers": layers,
        "feature_counts": {
            name: len(geojson.get("features", []))
            for name, geojson in layers.items()
        },
    }