"""Write the small data files the website loads.

The pipeline's own files are large (every OSM tag, every business). The site
needs only what a pin and its info panel show, one file per district, so a
visitor downloads just the district they are looking at.

Input:  data/processed/districts.geojson, data/processed/small_businesses.geojson
Output: public/data/districts.geojson          (simplified outlines + counts)
        public/data/businesses/<district>.geojson
        public/data/search.json                 (every business name, for the search bar)
Run from repo root: .venv/bin/python pipeline/load/export_site_data.py
"""

from pathlib import Path
import json

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
SITE_DATA = ROOT / "public" / "data"

# About 20 m: invisible at district zoom, cuts the outline file a lot
SIMPLIFY_DEGREES = 0.0002
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
}
FALLBACKS = {"phone": "contact:phone", "website": "contact:website"}


def business_feature(row) -> dict:
    properties = {}
    for source, key in FIELDS.items():
        value = row.get(source)
        if not isinstance(value, str) or not value:
            value = row.get(FALLBACKS.get(key, ""), None)
        if isinstance(value, str) and value:
            properties[key] = value
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [
                round(row.geometry.x, COORDINATE_DECIMALS),
                round(row.geometry.y, COORDINATE_DECIMALS),
            ],
        },
        "properties": properties,
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")))


def main() -> None:
    businesses = gpd.read_file(PROCESSED / "small_businesses.geojson")
    districts = gpd.read_file(PROCESSED / "districts.geojson")

    counts = businesses.groupby("district").size()
    districts["business_count"] = districts.id.map(counts).fillna(0).astype(int)
    districts["has_data"] = districts.business_count > 0
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    districts["geometry"] = districts.geometry.simplify(SIMPLIFY_DEGREES, preserve_topology=True)
    districts[["id", "state", "number", "metro", "business_count", "has_data", "geometry"]].to_file(
        SITE_DATA / "districts.geojson", driver="GeoJSON", COORDINATE_PRECISION=COORDINATE_DECIMALS
    )

    for district_id, group in businesses.groupby("district"):
        features = [business_feature(row) for _, row in group.iterrows()]
        write_json(
            SITE_DATA / "businesses" / f"{district_id}.geojson",
            {"type": "FeatureCollection", "features": features},
        )

    # Search index: one compact row per business across every district, so the
    # search bar can find a business without loading every district's file.
    # Row: [id, name, district, group, category, street, city, lon, lat]
    rows = [
        [
            row["osm_id"],
            row["name"],
            row["district"],
            row["group"],
            row["category"],
            row.get("addr:street") if isinstance(row.get("addr:street"), str) else "",
            row.get("addr:city") if isinstance(row.get("addr:city"), str) else "",
            round(row.geometry.x, COORDINATE_DECIMALS),
            round(row.geometry.y, COORDINATE_DECIMALS),
        ]
        for _, row in businesses.sort_values("name").iterrows()
    ]
    write_json(SITE_DATA / "search.json", {"rows": rows})

    for path in sorted([*SITE_DATA.rglob("*.geojson"), SITE_DATA / "search.json"]):
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1_000_000:.2f} MB")


if __name__ == "__main__":
    main()
