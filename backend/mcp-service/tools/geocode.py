import os
import requests
from dotenv import load_dotenv

# Load .env from the mcp-service root (one level up from tools/)
_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, "..", ".env"))

MAPBOX_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN")

def geocode_address(address: str) -> dict:
    if not MAPBOX_TOKEN:
        return {"ok": False, "error": "Missing MAPBOX_ACCESS_TOKEN"}

    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json"
    params = {"access_token": MAPBOX_TOKEN, "limit": 1}

    try:
        r = requests.get(url, params=params, timeout=20)
        if r.status_code != 200:
            return {"ok": False, "error": f"Mapbox error {r.status_code}", "raw": r.text}

        data = r.json()
        feats = data.get("features", [])
        if not feats:
            return {"ok": False, "error": "No results found"}

        f = feats[0]
        lon, lat = f["center"]

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return {"ok": False, "error": "Invalid coordinates returned"}

        return {
            "ok": True,
            "latitude": lat,
            "longitude": lon,
            "display_name": f.get("place_name", address),
            "address": address,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
