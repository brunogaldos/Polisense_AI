"""
precompute_baseline.py
======================
Run ONCE to precompute baseline anomaly and VCI classification polygons
for each calendar month (1-12).

Uses MODIS MOD13Q1 (250m, 16-day composites) for the baseline.
MODIS advantages over Sentinel-2 for baseline:
  - 250m resolution is sufficient for multi-year percentile polygons
  - No cloud masking pipeline needed (MODIS ships pre-composited, QA-filtered)
  - 20+ years of data = far more images per month = more stable percentiles
  - Much faster EE computation than Sentinel-2 at this scale

At query time, antapaccay_tool.py uses Sentinel-2 (10m) for current NDVI
and re-evaluates it against the P10/P50/P90 stored here per polygon.

Output layout
-------------
antapaccay_data/
  baseline/
    01/
      anomaly.geojson   <- polygons with P10/P50/P90 as properties
      vci.geojson
      meta.json
    02/ ... 12/

Usage
-----
    set -a && source .env && set +a && python precompute_baseline.py
    python precompute_baseline.py --months 3 4 5
    python precompute_baseline.py --out ./my_data
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ── Mine constants ────────────────────────────────────────────────────────────
MINE_LON  = -72.206
MINE_LAT  = -14.034
BUFFER_KM      = 7
MIN_PATCH_HA   = 1.0
MAX_FEATURES   = 1_000

# ── MODIS constants ───────────────────────────────────────────────────────────
# MOD13Q1: 250m, 16-day NDVI composite, global, 2000-present
# NDVI band is scaled by 0.0001 → divide to get [-1, 1]
# QA band: keep only pixels where bits 0-1 == 0 (good quality) or == 1 (marginal)
MODIS_COLLECTION  = "MODIS/061/MOD13Q1"
MODIS_NDVI_SCALE  = 0.0001
MODIS_SCALE       = 250        # native resolution in metres
BASELINE_START    = "2019-01-01"   # longer baseline = more stable percentiles
BASELINE_END      = "2020-12-31"
PERCENTILES       = [10, 25, 50, 75, 90]

ANOMALY_CLASS_LABELS = {"0":"strong_negative","1":"negative","2":"near_normal","3":"positive","4":"strong_positive"}
VCI_CLASS_LABELS     = {"0":"very_low_vci","1":"low_vci","2":"moderate_vci","3":"healthy_vci","4":"very_healthy_vci"}


# ── EE init ───────────────────────────────────────────────────────────────────

def _init_ee():
    import ee
    project         = os.environ["EE_PROJECT"]
    service_account = os.environ["EE_SERVICE_ACCOUNT"]
    key_data        = json.loads(os.environ["EE_KEY_JSON"])
    creds = ee.ServiceAccountCredentials(service_account, key_data=json.dumps(key_data))
    ee.Initialize(creds)
    return ee


# ── MODIS helpers ─────────────────────────────────────────────────────────────

def _mask_modis_qa(image):
    """
    Keep only good-quality MODIS pixels using the SummaryQA band.
    SummaryQA == 0 → good data
    SummaryQA == 1 → marginal data (keep — high-altitude sites like Antapaccay
                     at 4100m often only get marginal QA due to thin atmosphere)
    SummaryQA >= 2 → snow/ice or cloudy → mask out
    """
    import ee as _ee  # local import so module works without ee at import time
    qa   = image.select("SummaryQA")
    good = qa.lte(1)   # 0 or 1 → keep
    return image.updateMask(good)


def _add_modis_ndvi(image):
    """Scale NDVI to [-1, 1] and attach time properties."""
    ndvi = (image.select("NDVI")
            .multiply(0.0001)          # MODIS scale factor
            .rename("NDVI")
            .clamp(-1, 1)
            .copyProperties(image, ["system:time_start"]))
    return ndvi


# ── Core baseline computation ─────────────────────────────────────────────────

def _compute_baseline_month(ee, month: int) -> tuple[dict, dict, dict]:
    """
    Build MODIS baseline percentile image for one calendar month,
    vectorise anomaly + VCI polygons, store P10/P50/P90 per polygon.

    Returns (anomaly_geojson, vci_geojson, meta_dict)
    """
    center   = ee.Geometry.Point([MINE_LON, MINE_LAT])
    region   = center.buffer(BUFFER_KM * 1_000)
    region_s = region.simplify(100)   # 100m simplify is fine at 250m resolution

    # MODIS 16-day composites filtered to the calendar month across all years
    baseline_col = (
        ee.ImageCollection(MODIS_COLLECTION)
        .filterDate(BASELINE_START, BASELINE_END)
        .filterBounds(region)
        .filter(ee.Filter.calendarRange(month, month, "month"))
        .map(_mask_modis_qa)
        .map(_add_modis_ndvi)
        .select("NDVI")
    )

    n_images = baseline_col.size().getInfo()
    if n_images == 0:
        raise ValueError(f"No MODIS images for month {month}")
    print(f"  Month {month:02d}: {n_images} MODIS composites")

    # Percentile composite — with 20+ years * ~2 composites/month = ~40-50 images
    # per month, percentiles are very stable
    threshold = (
        baseline_col
        .reduce(ee.Reducer.percentile(PERCENTILES))
        .rename([f"P{p}" for p in PERCENTILES])
        .clip(region_s)
    )

    p10 = threshold.select("P10")
    p50 = threshold.select("P50")
    p90 = threshold.select("P90")

    # VCI uses the full P10-P90 range as the denominator (robust to outliers)
    robust_vci = (
        p50.subtract(p10)                        # at baseline, current = P50
        .divide(p90.subtract(p10).max(ee.Image(0.01)))
        .multiply(100).clamp(0, 100)
        .rename("robust_vci")
    )

    # Anomaly at baseline = P50 - P50 = 0 everywhere → all polygons are near_normal.
    # That's correct: we're storing polygon GEOMETRY from the baseline distribution,
    # not the classification. The actual class is computed fresh at query time.
    # We still vectorise here using VCI classes so polygons represent meaningful
    # spatial units (areas that historically have low/medium/high VCI).
    ndvi_anomaly = p50.subtract(p50).rename("ndvi_anomaly")   # = 0, used for geometry only

    anomaly_class = (
        ee.Image(2)   # near_normal at baseline
        .updateMask(p50.mask())
        .rename("anomaly_class").toUint8()
    )

    vci_class = (
        ee.Image(2)
        .where(robust_vci.lt(20), 0)
        .where(robust_vci.gte(20).And(robust_vci.lt(35)), 1)
        .where(robust_vci.gte(50).And(robust_vci.lt(75)), 3)
        .where(robust_vci.gte(75), 4)
        .updateMask(robust_vci.mask())
        .rename("vci_class").toUint8()
    )

    # Fused image — P10/P50/P90 stored alongside class bands so they get
    # attached as polygon properties and reused at query time
    analysis = (
        threshold                      # P10 P25 P50 P75 P90
        .addBands(anomaly_class)
        .addBands(vci_class)
        .addBands(robust_vci)
        .clip(region_s)
    )

    label_anomaly = ee.Dictionary(ANOMALY_CLASS_LABELS)
    label_vci     = ee.Dictionary(VCI_CLASS_LABELS)

    def _add_props(feature, class_band, label_ee):
        geom     = feature.geometry()
        centroid = geom.centroid(1)
        coords   = centroid.coordinates()
        # P10/P50/P90 stored per polygon — the key data needed at query time
        stats = analysis.select(["P10", "P50", "P90", "robust_vci"]).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=MODIS_SCALE,
            maxPixels=1e13, bestEffort=True, tileScale=4,
        )
        class_name = label_ee.get(ee.Number(feature.get(class_band)).toInt().format())
        return (feature.set(stats)
                .set({
                    "class_name":      class_name,
                    "area_ha":         geom.area(1).divide(10_000),
                    "centroid_lon":    coords.get(0),
                    "centroid_lat":    coords.get(1),
                    "dist_mine_km":    centroid.distance(center, 1).divide(1_000),
                    "baseline_month":  month,
                    "baseline_source": "MODIS/061/MOD13Q1",
                }))

    def _vectorize(class_band, label_ee, min_area=MIN_PATCH_HA):
        img  = analysis.select(class_band)
        vecs = img.reduceToVectors(
            geometry=region_s,
            scale=MODIS_SCALE,          # vectorise at native MODIS resolution
            geometryType="polygon",
            eightConnected=True,
            labelProperty=class_band,
            reducer=ee.Reducer.countEvery(),
            maxPixels=1e13, bestEffort=True, tileScale=8,
        )
        vecs = vecs.map(lambda f: _add_props(f, class_band, label_ee))
        if min_area > 0:
            vecs = vecs.filter(ee.Filter.gte("area_ha", min_area))
        return vecs.sort("area_ha", False).limit(MAX_FEATURES)

    fc_anomaly = _vectorize("anomaly_class", label_anomaly)
    fc_vci     = _vectorize("vci_class",     label_vci)

    # Parallel materialisation
    results: dict = {}

    def _fetch(name, fc):
        t0   = time.time()
        data = fc.getInfo()
        print(f"    [{name}] {len(data.get('features', []))} features in {time.time()-t0:.1f}s")
        return name, data

    with ThreadPoolExecutor(max_workers=2) as pool:
        for name, data in [f.result() for f in as_completed([
                pool.submit(_fetch, "anomaly", fc_anomaly),
                pool.submit(_fetch, "vci",     fc_vci)])]:
            results[name] = data

    meta = {
        "mine_name":        "antapaccay",
        "month":            month,
        "baseline_source":  MODIS_COLLECTION,
        "baseline_start":   BASELINE_START,
        "baseline_end":     BASELINE_END,
        "n_images":         n_images,
        "buffer_km":        BUFFER_KM,
        "scale":            MODIS_SCALE,
        "generated_at":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "feature_counts":   {k: len(v.get("features", [])) for k, v in results.items()},
        "note": (
            "Baseline polygons built from MODIS 250m composites. "
            "P10/P50/P90 stored per polygon for Sentinel-2 reclassification at query time."
        ),
    }
    return results["anomaly"], results["vci"], meta


# ── File I/O ──────────────────────────────────────────────────────────────────

def _save(out_base: Path, month: int, anomaly: dict, vci: dict, meta: dict):
    d = out_base / "baseline" / f"{month:02d}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "anomaly.geojson").write_text(json.dumps(anomaly))
    (d / "vci.geojson").write_text(json.dumps(vci))
    (d / "meta.json").write_text(json.dumps(meta, indent=2))
    sizes = {f.name: f"{f.stat().st_size/1024:.1f} KB"
             for f in d.iterdir() if f.is_file()}
    print(f"  Saved → {d}  {sizes}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Precompute MODIS baseline anomaly/VCI polygons for Antapaccay"
    )
    p.add_argument("--months", nargs="+", type=int,
                   default=list(range(1, 13)),
                   help="Months to compute (default: all 12)")
    p.add_argument("--out", default="./antapaccay_data",
                   help="Output base directory")
    args = p.parse_args()

    out_base = Path(args.out)
    print("Initialising Earth Engine …")
    ee = _init_ee()
    print(f"EE ready. Baseline: {BASELINE_START} → {BASELINE_END} | Source: {MODIS_COLLECTION}\n")

    for month in args.months:
        print(f"── Month {month:02d} ──────────────────────")
        t0 = time.time()
        try:
            anomaly, vci, meta = _compute_baseline_month(ee, month)
            _save(out_base, month, anomaly, vci, meta)
            print(f"  Done in {time.time()-t0:.1f}s\n")
        except ValueError as exc:
            print(f"  SKIP: {exc}\n")

    print("Baseline precompute complete.")


if __name__ == "__main__":
    main()