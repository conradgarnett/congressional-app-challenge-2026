"""Write the small data files the website loads.

The pipeline's own files are large (every OSM tag, every business). The site
needs only what a pin and its info panel show, cut into map tiles so a
visitor downloads just the tiles on their screen.

Tiles follow Organic Maps' renderer (organicmaps/organicmaps, libs/drape_frontend):
- Coordinates are Organic Maps' Mercator: x = longitude, y = latitude
  stretched by Mercator (geometry/mercator.cpp LatToY), both -180..180.
- A tile at zoom z is a square of 360 / 2^(z-1) Mercator degrees; tile (x, y)
  starts at x*size, y*size, counted from 0,0 with y going north
  (tile_key.cpp GetGlobalRect, tile_utils.cpp CalcTilesCoverage).
- Zoom 17 is the deepest data zoom (scales::GetUpperScale); closer views
  reuse zoom-17 tiles.
- Each zoom's tiles hold only what is drawn at that zoom, like their scale
  index: a business first appears at its `z`, the first zoom where it wins
  its cell (THIN_CELLS cells per tile side) in Organic Maps' overlay order:
  drules priority of its type first (a restaurant beats a hairdresser, as
  in their app), then `rank` (their "rank" byte): a fixed random number per
  business, so a shop with no website, phone or hours gets the same chance
  as a polished one. The app exists to help underserved businesses; ranking
  by how much is online would hide exactly them.
  `gz` is the same within its own map group, so a category tab zoomed out
  still has well-spread pins. At zoom 17 every business is in.

Every business here was judged independent by pipeline/filter/independent.py;
main() refuses to export anything that wasn't. Each also carries Organic
Maps' icon and overlay priority for its type (public/map/types.json, from
pipeline/style/build_style.py).

Input:  data/processed/small_businesses.geojson
Output: public/data/tiles/<z>/<x>_<y>.json   (one tile; GeoJSON plus count stats)
        public/data/tiles.json                (tile scheme + which tiles exist)
        public/data/search.json               (every business name, for the search bar)
Run from repo root: .venv/bin/python pipeline/load/export_site_data.py
"""

from pathlib import Path
import hashlib
import json
import math
import shutil
import sys

import geopandas as gpd
import pandas as pd
from tqdm import tqdm

from tagging import business_tags

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
SITE_DATA = ROOT / "public" / "data"
OM_TYPES = ROOT / "public" / "map" / "types.json"

sys.path.insert(0, str(ROOT / "pipeline" / "fetch"))
from businesses import REGION  # noqa: E402

# Organic Maps zoom = MapLibre zoom + 1 (their 256 px scale vs MapLibre's 512 px).
# Pins start at MapLibre zoom 9 (PINS_FROM_ZOOM in components/app/LocalMap.tsx).
MIN_TILE_ZOOM = 10
MAX_DATA_ZOOM = 17
# One business per cell per zoom: a tile is about 512 px on screen, so 32 px cells
THIN_CELLS = 16
# Count stats per tile: cells per side, so in-view counts are exact to 1/16 tile (32 px)
STAT_CELLS = 16
COORDINATE_DECIMALS = 5  # about 1 m

# Fields shown in the info panel, renamed to plain keys for the site
FIELDS = {
    "osm_id": "id",
    "name": "name",
    "group": "group",
    "category": "category",
    "cuisine": "cuisine",
    "opening_hours": "hours",
    "phone": "phone",
    "website": "website",
    "addr:housenumber": "housenumber",
    "addr:street": "street",
    "addr:city": "city",
    "addr:postcode": "postcode",
    "website:menu": "menu",
}
FALLBACKS = {"phone": "contact:phone", "website": "contact:website"}


def lat_to_y(lat: float) -> float:
    """Organic Maps' Mercator latitude (geometry/mercator.cpp LatToY)."""
    sin_lat = math.sin(math.radians(min(max(lat, -86.0), 86.0)))
    return min(max(math.degrees(0.5 * math.log((1 + sin_lat) / (1 - sin_lat))), -180.0), 180.0)


def tile_size(zoom: int) -> float:
    return 360.0 / (1 << (zoom - 1))


def properties_of(row) -> dict:
    properties = {}
    for source, key in FIELDS.items():
        value = row.get(source)
        if not isinstance(value, str) or not value:
            value = row.get(FALLBACKS.get(key, ""), None)
        if isinstance(value, str) and value:
            properties[key] = value
    return properties


def rank(osm_id: str) -> int:
    """0-255 from the OSM id: random-looking but the same on every run and every load."""
    return hashlib.sha256(osm_id.encode()).digest()[0]


def first_zoom(table: pd.DataFrame, by_group: bool) -> pd.Series:
    """First zoom where each business wins its cell in overlay order (its scale index)."""
    zooms = pd.Series(MAX_DATA_ZOOM, index=table.index)
    keys = ["group"] if by_group else []
    for zoom in range(MAX_DATA_ZOOM - 1, MIN_TILE_ZOOM - 1, -1):
        cell = tile_size(zoom) / THIN_CELLS
        cells = table.assign(cx=(table.x // cell).astype(int), cy=(table.y // cell).astype(int))
        # table is sorted best first, so the first in each cell wins
        winners = cells.drop_duplicates(subset=[*keys, "cx", "cy"]).index
        zooms[winners] = zoom
    return zooms


def stats_of(tile: pd.DataFrame, zoom: int, x: int, y: int) -> list:
    """Business counts per stat cell, by group and by group tag, for in-view counts."""
    cell = tile_size(zoom) / STAT_CELLS
    columns = ((tile.x - x * tile_size(zoom)) // cell).astype(int).clip(0, STAT_CELLS - 1)
    rows = ((tile.y - y * tile_size(zoom)) // cell).astype(int).clip(0, STAT_CELLS - 1)
    stats = []
    for (column, row), part in tile.groupby([columns, rows]):
        groups: dict[str, int] = {}
        tags: dict[str, dict[str, int]] = {}
        for group, tag_list in zip(part.group, part.tags):
            groups[group] = groups.get(group, 0) + 1
            group_tags = tags.setdefault(group, {})
            for tag in tag_list:
                group_tags[tag] = group_tags.get(tag, 0) + 1
        stats.append({"c": [int(column), int(row)], "g": groups, "t": tags})
    return stats


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")))


def check_filtered(businesses: gpd.GeoDataFrame) -> None:
    """Stop unless every business was judged independent, with a map group."""
    decisions = pd.read_csv(PROCESSED / "business_decisions.csv", usecols=["osm_id", "independent"])
    independent = set(decisions.osm_id[decisions.independent])
    strays = set(businesses.osm_id) - independent
    no_group = int(businesses.group.isna().sum())
    if strays or no_group:
        sys.exit(
            f"{len(strays)} businesses were not judged independent and {no_group} have no group. "
            "Rerun pipeline/filter/independent.py before exporting."
        )


def om_rule(category: str, om_types: dict) -> dict:
    """Organic Maps' rule for "shop=bakery" (type shop-bakery), else their generic shop/craft rule."""
    key = category.split("=")[0]
    return om_types.get(category.replace("=", "-")) or om_types.get(key) or om_types["shop"]


def main() -> None:
    businesses = gpd.read_file(PROCESSED / "small_businesses.geojson")
    check_filtered(businesses)
    om_types = json.loads(OM_TYPES.read_text())

    records = []
    for _, row in businesses.iterrows():
        properties = properties_of(row)
        tags = business_tags(row)
        rule = om_rule(row["category"], om_types)
        records.append(
            {
                "properties": properties,
                "tags": tags,
                "group": row["group"],
                "id": row["osm_id"],
                "rank": rank(row["osm_id"]),
                "icon": rule["icon"],
                "priority": rule["priority"],
                "lon": round(row.geometry.x, COORDINATE_DECIMALS),
                "lat": round(row.geometry.y, COORDINATE_DECIMALS),
            }
        )
    table = pd.DataFrame(records)
    table["x"] = table.lon
    table["y"] = table.lat.map(lat_to_y)
    # Organic Maps' overlay order, best first; the id breaks ties so every run picks the same pins
    table = table.sort_values(["priority", "rank", "id"], ascending=[False, False, True]).reset_index(drop=True)
    table["z"] = first_zoom(table, by_group=False)
    table["gz"] = first_zoom(table, by_group=True)
    table["shown_from"] = table[["z", "gz"]].min(axis=1)

    # Start clean so tiles that are now empty don't linger
    shutil.rmtree(SITE_DATA / "tiles", ignore_errors=True)
    index: dict[str, int] = {}
    for zoom in tqdm(range(MIN_TILE_ZOOM, MAX_DATA_ZOOM + 1), desc="Exporting zooms", unit="zoom"):
        size = tile_size(zoom)
        keyed = table.assign(tx=(table.x // size).astype(int), ty=(table.y // size).astype(int))
        for (x, y), tile in keyed.groupby(["tx", "ty"]):
            drawn = tile[tile.shown_from <= zoom]
            features = [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [b.lon, b.lat]},
                    # tags as ";pizza;italian;restaurant;" so the map can match whole tags with a substring test
                    "properties": {
                        **b.properties,
                        "tags": f";{';'.join(b.tags)};",
                        "rank": b.rank,
                        "icon": b.icon,
                        "priority": b.priority,
                        "z": b.z,
                        "gz": b.gz,
                    },
                }
                for b in drawn.itertuples()
            ]
            data = {"type": "FeatureCollection", "features": features}
            # Zoom 17 tiles hold every business, so the site counts them directly
            if zoom < MAX_DATA_ZOOM:
                data["stats"] = stats_of(tile, zoom, x, y)
            write_json(SITE_DATA / "tiles" / str(zoom) / f"{x}_{y}.json", data)
            index[f"{zoom}/{x}_{y}"] = len(features)

    # The site asks only for tiles listed here, so empty ones never 404
    write_json(
        SITE_DATA / "tiles.json",
        {
            "scheme": "organicmaps",
            "min_zoom": MIN_TILE_ZOOM,
            "max_zoom": MAX_DATA_ZOOM,
            "stat_cells": STAT_CELLS,
            "region": list(REGION),
            "tiles": index,
        },
    )

    # Search index: one compact row per business, so the search bar can find
    # a business without loading every tile.
    # Row: [id, name, group, category, street, city, lon, lat, tags]
    rows = [
        [
            row["osm_id"],
            row["name"],
            row["group"],
            row["category"],
            row.get("addr:street") if isinstance(row.get("addr:street"), str) else "",
            row.get("addr:city") if isinstance(row.get("addr:city"), str) else "",
            round(row.geometry.x, COORDINATE_DECIMALS),
            round(row.geometry.y, COORDINATE_DECIMALS),
            ";".join(business_tags(row)),
        ]
        for _, row in businesses.sort_values("name").iterrows()
    ]
    write_json(SITE_DATA / "search.json", {"rows": rows})

    print(f"{len(businesses)} businesses, all through the filter pipeline")
    for zoom in range(MIN_TILE_ZOOM, MAX_DATA_ZOOM + 1):
        paths = list((SITE_DATA / "tiles" / str(zoom)).glob("*.json"))
        sizes = sorted(path.stat().st_size for path in paths)
        drawn = sum(count for key, count in index.items() if key.startswith(f"{zoom}/"))
        print(
            f"Zoom {zoom}: {len(paths)} tiles, {drawn} pins, "
            f"median {sizes[len(sizes) // 2] / 1000:.0f} KB, largest {sizes[-1] / 1000:.0f} KB"
        )
    print(f"search.json: {(SITE_DATA / 'search.json').stat().st_size / 1_000_000:.2f} MB")


if __name__ == "__main__":
    main()
