import json
from pathlib import Path

try:
    import ee
except ImportError: 
    ee = None
import os
import json
from dotenv import load_dotenv

load_dotenv("backend\env_ee")

S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"
S2_SCALE = 10000.0
MAX_CLOUD_PCT = 60
PERCENTILES = [10, 25, 50, 75, 90]
SCL_BAD_VALUES = [0, 1, 2, 3, 7, 8, 9, 10, 11]

DEFAULT_BASELINE_START = "2019-01-01"
DEFAULT_BASELINE_END = "2024-12-31"

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


def initialize_earth_engine():
    project = os.getenv("EE_PROJECT")
    service_account = os.getenv("EE_SERVICE_ACCOUNT")
    key_json = os.getenv("EE_KEY_JSON")
    key_data = json.loads(key_json)
    credentials = ee.ServiceAccountCredentials(
    service_account,
    key_data=json.dumps(key_data)
    )
    

    if ee is None:
        raise RuntimeError(
            "earthengine-api is not installed in the MCP service environment. "
            "Install backend/mcp-service/requirements.txt before using NDVI tools."
        )
    else:
        ee.Initialize(credentials=credentials, project=project)


def make_mine_region(lon, lat, buffer_km):
    mine_center = ee.Geometry.Point([lon, lat])
    region = mine_center.buffer(buffer_km * 1000)
    return mine_center, region, region.simplify(30)


def mask_s2_clouds_scl(image):
    scl = image.select("SCL")
    good = scl.neq(SCL_BAD_VALUES[0])
    for value in SCL_BAD_VALUES[1:]:
        good = good.And(scl.neq(value))
    return image.updateMask(good)


def add_s2_ndvi(image):
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


def build_s2_ndvi_collection(start_date, end_date, region):
    return (
        ee.ImageCollection(S2_COLLECTION)
        .filterDate(start_date, end_date)
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", MAX_CLOUD_PCT))
        .map(mask_s2_clouds_scl)
        .map(add_s2_ndvi)
        .select("NDVI")
    )


def make_monthly_threshold(month, region, baseline_start, baseline_end):
    baseline_col = build_s2_ndvi_collection(baseline_start, baseline_end, region)
    month_col = baseline_col.filter(ee.Filter.calendarRange(month, month, "month"))
    count = month_col.size().getInfo()
    if count == 0:
        raise ValueError("No baseline Sentinel-2 images found for the requested month.")
    return (
        month_col
        .reduce(ee.Reducer.percentile(PERCENTILES))
        .rename([f"P{p}" for p in PERCENTILES])
        .clip(region)
    )


def make_current_monthly_ndvi(year, month, region):
    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, "month")
    current_col = build_s2_ndvi_collection(start, end, region)
    count = current_col.size().getInfo()
    if count == 0:
        raise ValueError("No current Sentinel-2 images found for the requested month.")
    return (
        current_col.median().rename("current_ndvi")
        .clip(region)
        .set("year", year)
        .set("month", month)
    )


def calculate_stress_layers(current_ndvi, threshold_img, region):
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
        .addBands(p10.rename("P10"))
        .addBands(p25.rename("P25"))
        .addBands(p50.rename("P50"))
        .addBands(p75.rename("P75"))
        .addBands(p90.rename("P90"))
        .addBands(ndvi_anomaly)
        .addBands(robust_vci)
        .addBands(severity)
        .addBands(stress_class)
        .clip(region)
    )


def classify_anomaly(stress_result):
    anomaly = stress_result.select("ndvi_anomaly")
    return (
        ee.Image(2)
        .where(anomaly.lt(-0.20), 0)
        .where(anomaly.gte(-0.20).And(anomaly.lt(-0.08)), 1)
        .where(anomaly.gte(0.08).And(anomaly.lt(0.20)), 3)
        .where(anomaly.gte(0.20), 4)
        .updateMask(anomaly.mask())
        .rename("anomaly_class")
        .toUint8()
    )


def classify_vci(stress_result):
    vci = stress_result.select("robust_vci")
    return (
        ee.Image(2)
        .where(vci.lt(20), 0)
        .where(vci.gte(20).And(vci.lt(35)), 1)
        .where(vci.gte(50).And(vci.lt(75)), 3)
        .where(vci.gte(75), 4)
        .updateMask(vci.mask())
        .rename("vci_class")
        .toUint8()
    )


def add_common_vector_properties(feature, stress_result, mine_center, scale):
    geom = feature.geometry()
    centroid = geom.centroid(1)
    coords = centroid.coordinates()
    stats = stress_result.select(
        ["current_ndvi", "P50", "ndvi_anomaly", "robust_vci", "severity"]
    ).reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=scale,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=8,
    )
    return feature.set(stats).set({
        "area_ha": geom.area(1).divide(10000),
        "centroid_lon": coords.get(0),
        "centroid_lat": coords.get(1),
        "dist_mine_km": centroid.distance(mine_center, 1).divide(1000),
    })


def vectorize_class_image(
    class_img,
    class_band,
    label_lookup,
    stress_result,
    region,
    mine_center,
    scale,
    min_area_ha=0.0,
    max_features=5000,
):
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

    def add_props(feature):
        class_value = ee.Number(feature.get(class_band)).toInt()
        class_name = ee.Dictionary(label_lookup).get(class_value.format())
        return add_common_vector_properties(
            feature, stress_result, mine_center, scale
        ).set({"class_name": class_name})

    vectors = vectors.map(add_props)
    if min_area_ha > 0:
        vectors = vectors.filter(ee.Filter.gte("area_ha", min_area_ha))
    return vectors.sort("area_ha", False).limit(max_features)


def build_geojson_layers(
    lon,
    lat,
    year,
    month,
    buffer_km=7.0,
    baseline_start=DEFAULT_BASELINE_START,
    baseline_end=DEFAULT_BASELINE_END,
    scale=30,
    min_patch_ha=5.0,
    max_features=5000,
):
    mine_center, region, region_simple = make_mine_region(lon, lat, buffer_km)
    threshold_img = make_monthly_threshold(month, region, baseline_start, baseline_end)
    current_ndvi = make_current_monthly_ndvi(year, month, region)
    stress_result = calculate_stress_layers(current_ndvi, threshold_img, region)

    anomaly_class = classify_anomaly(stress_result)
    vci_class = classify_vci(stress_result)
    stress_class = stress_result.select("stress_class")
    severe_extreme = stress_class.gte(3).selfMask().rename("severe_extreme")

    layers = {
        "mine_point": ee.FeatureCollection([
            ee.Feature(mine_center, {
                "layer": "mine_point",
                "lon": lon,
                "lat": lat,
            })
        ]),
        "buffer": ee.FeatureCollection([
            ee.Feature(region_simple, {
                "layer": "buffer",
                "buffer_km": buffer_km,
            })
        ]),
        "anomaly": vectorize_class_image(
            anomaly_class,
            "anomaly_class",
            ANOMALY_CLASS_LABELS,
            stress_result,
            region_simple,
            mine_center,
            scale,
            max_features=max_features,
        ),
        "vci": vectorize_class_image(
            vci_class,
            "vci_class",
            VCI_CLASS_LABELS,
            stress_result,
            region_simple,
            mine_center,
            scale,
            max_features=max_features,
        ),
        "stress_class": vectorize_class_image(
            stress_class,
            "stress_class",
            STRESS_CLASS_LABELS,
            stress_result,
            region_simple,
            mine_center,
            scale,
            max_features=max_features,
        ),
        "severe_extreme": vectorize_class_image(
            severe_extreme,
            "severe_extreme",
            {"1": "severe_or_extreme_stress"},
            stress_result,
            region_simple,
            mine_center,
            scale,
            min_area_ha=min_patch_ha,
            max_features=max_features,
        ),
    }
    return {name: feature_collection.getInfo() for name, feature_collection in layers.items()}



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
    max_features: int = 1000,
) -> dict:
    """
    Generate Mapbox-ready GeoJSON layers for mine-area vegetation stress.

    This version does NOT write files.
    It returns GeoJSON directly.

    Returned layers:
      mine_point
      buffer
      anomaly
      vci
      stress_class
      severe_extreme
    """

    initialize_earth_engine()

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