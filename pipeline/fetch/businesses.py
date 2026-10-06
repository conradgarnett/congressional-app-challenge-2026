"""Pull businesses from OpenStreetMap for each congressional district.

Queries the Overpass API once per district (bounding box), caches the raw
response in data/raw/osm/, then clips to the real district shape and tags
each business with its district id.

Default: metro districts only. Pass --all for every DC/MD/VA district.
Pass --refresh to ignore the cache and re-download.

Needs data/processed/districts.geojson (run districts.py first).
Output: data/processed/businesses.geojson
Run from repo root: .venv/bin/python pipeline/fetch/businesses.py [--all] [--refresh]
"""

from pathlib import Path
import argparse
import json
import time

import geopandas as gpd
import requests
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "raw" / "osm"
DISTRICTS = ROOT / "data" / "processed" / "districts.geojson"
OUT = ROOT / "data" / "processed" / "businesses.geojson"

# Public servers are shared and often busy; try each in turn
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
ATTEMPTS_PER_SERVER = 2
# Overpass rejects requests without a descriptive User-Agent
HEADERS = {"User-Agent": "md08-local-map/0.1 (Congressional App Challenge student project)"}
PAUSE_SECONDS = 10  # be polite to the shared public server

AMENITIES = "restaurant|cafe|fast_food|bar|pub|ice_cream|pharmacy"

# Tags kept on each business; everything else is dropped
KEEP_TAGS = [
    "name", "brand", "brand:wikidata", "operator", "website", "phone", "email",
    "contact:website", "contact:phone", "contact:instagram", "contact:facebook",
    "opening_hours", "cuisine",
    "addr:housenumber", "addr:street", "addr:city", "addr:postcode",
    # Details that become feature tags (pipeline/load/tagging.py)
    "takeaway", "delivery", "outdoor_seating", "drive_through", "wheelchair",
    "internet_access", "website:menu",
]
# Every diet:* tag is kept too (diet:vegan, diet:halal, ...)
KEEP_TAG_PREFIXES = ("diet:",)


def overpass_query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:300];
(
  nwr["shop"]({bbox});
  nwr["amenity"~"^({AMENITIES})$"]({bbox});
  nwr["craft"]({bbox});
);
out center tags;
"""


def fetch_district(district_id: str, bounds, refresh: bool) -> list[dict]:
    path = CACHE / f"{district_id}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())["elements"]

    west, south, east, north = bounds
    query = overpass_query(south, west, north, east)
    errors = []
    for url in OVERPASS_URLS:
        for attempt in range(ATTEMPTS_PER_SERVER):
            try:
                response = requests.post(url, data={"data": query}, headers=HEADERS, timeout=360)
                response.raise_for_status()
                elements = response.json()["elements"]
            except (requests.RequestException, ValueError, KeyError) as error:
                errors.append(f"{url}: {error}")
                print(f"  {district_id}: {url} failed ({error}), retrying", flush=True)
                time.sleep(PAUSE_SECONDS * (attempt + 1))
                continue
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_text(response.text)
            time.sleep(PAUSE_SECONDS)
            return elements
    raise RuntimeError(f"All Overpass servers failed for {district_id}:\n" + "\n".join(errors))


def category(tags: dict) -> str:
    for key in ("shop", "amenity", "craft"):
        if key in tags:
            return f"{key}={tags[key]}"
    return "unknown"


def to_record(element: dict) -> dict | None:
    # Nodes carry lat/lon directly; ways and relations carry a computed center
    point = element if element["type"] == "node" else element.get("center")
    if not point:
        return None
    tags = element.get("tags", {})
    record = {
        "osm_id": f"{element['type']}/{element['id']}",
        "category": category(tags),
        "lat": point["lat"],
        "lon": point["lon"],
    }
    record.update({key: tags[key] for key in KEEP_TAGS if key in tags})
    record.update({key: value for key, value in tags.items() if key.startswith(KEEP_TAG_PREFIXES)})
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="every district, not just metro")
    parser.add_argument("--refresh", action="store_true", help="re-download cached districts")
    args = parser.parse_args()

    districts = gpd.read_file(DISTRICTS)
    if not args.all:
        districts = districts[districts.metro]

    records = {}
    for district in tqdm(districts.itertuples(), desc="Fetching businesses", unit="dist"):
        elements = fetch_district(district.id, district.geometry.bounds, args.refresh)
        for element in elements:
            record = to_record(element)
            if record:
                records[record["osm_id"]] = record  # bounding boxes overlap; dedupe

    points = gpd.GeoDataFrame(
        list(records.values()),
        geometry=gpd.points_from_xy(
            [r["lon"] for r in records.values()], [r["lat"] for r in records.values()]
        ),
        crs=4326,
    )
    # Keep only businesses inside a selected district, and record which one
    joined = gpd.sjoin(points, districts[["id", "geometry"]], predicate="within", how="inner")
    joined = joined.rename(columns={"id": "district"}).drop(columns=["index_right", "lat", "lon"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    joined.to_file(OUT, driver="GeoJSON")

    print(f"Wrote {len(joined)} businesses to {OUT.relative_to(ROOT)}")
    print(joined.district.value_counts().sort_index().to_string())


if __name__ == "__main__":
    main()
