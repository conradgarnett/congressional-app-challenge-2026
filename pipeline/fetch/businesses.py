"""Pull businesses from OpenStreetMap for the DC area.

The area (REGION) is cut into square cells; the Overpass API is queried once
per cell and each raw response is cached in data/raw/osm/cells/. To cover more
ground, widen REGION and run again: cached cells are reused.

Pass --refresh to ignore the cache and re-download.
Pass --offline to use cached cells only (when the public servers are busy).

Output: data/processed/businesses.geojson
Run from repo root: .venv/bin/python pipeline/fetch/businesses.py [--refresh | --offline]
"""

from pathlib import Path
import argparse
import json
import math
import time

import geopandas as gpd
import requests
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "raw" / "osm" / "cells"
OUT = ROOT / "data" / "processed" / "businesses.geojson"

# [west, south, east, north]: DC plus the inner Maryland and Virginia suburbs,
# from Frederick and Columbia down to Fredericksburg's edge and out to Leesburg
REGION = (-77.9, 38.3, -76.5, 39.7)
# One Overpass query per cell. Small enough that a dense downtown cell
# finishes well inside the server's time limit.
CELL_DEGREES = 0.2

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


def cells() -> list[tuple[str, tuple[float, float, float, float]]]:
    """(name, bounds) for every cell covering REGION"""
    west, south, east, north = REGION
    columns = math.ceil(round((east - west) / CELL_DEGREES, 6))
    rows = math.ceil(round((north - south) / CELL_DEGREES, 6))
    result = []
    for row in range(rows):
        for column in range(columns):
            cell_west = round(west + column * CELL_DEGREES, 6)
            cell_south = round(south + row * CELL_DEGREES, 6)
            bounds = (cell_west, cell_south, min(cell_west + CELL_DEGREES, east), min(cell_south + CELL_DEGREES, north))
            result.append((f"{cell_west:.2f}_{cell_south:.2f}", bounds))
    return result


def fetch_cell(cell: str, bounds, refresh: bool) -> list[dict]:
    path = CACHE / f"{cell}.json"
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
                print(f"  {cell}: {url} failed ({error}), retrying", flush=True)
                time.sleep(PAUSE_SECONDS * (attempt + 1))
                continue
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_text(response.text)
            time.sleep(PAUSE_SECONDS)
            return elements
    raise RuntimeError(f"All Overpass servers failed for cell {cell}:\n" + "\n".join(errors))


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
    parser.add_argument("--refresh", action="store_true", help="re-download cached cells")
    parser.add_argument("--offline", action="store_true", help="use cached cells only")
    args = parser.parse_args()

    records = {}
    missing = []
    for cell, bounds in tqdm(cells(), desc="Fetching businesses", unit="cell"):
        if args.offline and not (CACHE / f"{cell}.json").exists():
            missing.append(cell)
            continue
        try:
            elements = fetch_cell(cell, bounds, args.refresh)
        except RuntimeError as error:
            # Keep going: the cells that worked are cached, so the next run
            # only asks for the missing ones
            print(error, flush=True)
            missing.append(cell)
            continue
        for element in elements:
            record = to_record(element)
            if record:
                records[record["osm_id"]] = record  # a way on a cell edge comes back twice; dedupe

    points = gpd.GeoDataFrame(
        list(records.values()),
        geometry=gpd.points_from_xy(
            [r["lon"] for r in records.values()], [r["lat"] for r in records.values()]
        ),
        crs=4326,
    )
    # A way's center can fall just outside the cells that returned it
    west, south, east, north = REGION
    points = points.cx[west:east, south:north].drop(columns=["lat", "lon"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    points.to_file(OUT, driver="GeoJSON")

    print(f"Wrote {len(points)} businesses to {OUT.relative_to(ROOT)}")
    if missing:
        print(f"{len(missing)} of {len(cells())} cells failed: {', '.join(missing)}. Run again later to fill them in.")


if __name__ == "__main__":
    main()
