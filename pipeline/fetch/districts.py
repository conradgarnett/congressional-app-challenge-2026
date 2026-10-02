"""Build congressional district boundaries for DC, Maryland, and Virginia.

Source: Census cartographic boundary files, 119th Congress (current lines;
Virginia's 2026 redraw was struck down and Maryland's never passed).
Each district is flagged `metro` if at least 25% of its area falls inside the
Washington-Arlington-Alexandria metro area (CBSA 47900). Metro districts are
built out first.

Output: data/processed/districts.geojson
Run from repo root: .venv/bin/python pipeline/fetch/districts.py
"""

from pathlib import Path
import urllib.request

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed" / "districts.geojson"

DISTRICTS_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_500k.zip"
METROS_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cbsa_500k.zip"

STATES = {"11": "DC", "24": "MD", "51": "VA"}
DC_METRO_CBSA = "47900"
METRO_MIN_SHARE = 0.25
EQUAL_AREA_CRS = 5070  # meters, for area math


def download(url: str) -> Path:
    path = RAW / url.rsplit("/", 1)[1]
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def district_id(state: str, number: str) -> str:
    # DC's single delegate seat is coded "98" by the Census
    return f"{state}-AL" if number in ("98", "00") else f"{state}-{number}"


def main() -> None:
    districts = gpd.read_file(download(DISTRICTS_URL))
    districts = districts[districts.STATEFP.isin(STATES)].copy()

    metros = gpd.read_file(download(METROS_URL))
    dc_metro = metros[metros.CBSAFP == DC_METRO_CBSA].to_crs(EQUAL_AREA_CRS).geometry.union_all()

    projected = districts.geometry.to_crs(EQUAL_AREA_CRS)
    districts["metro_share"] = (projected.intersection(dc_metro).area / projected.area).round(3)
    districts["metro"] = districts.metro_share >= METRO_MIN_SHARE

    districts["state"] = districts.STATEFP.map(STATES)
    districts["number"] = districts.CD119FP
    districts["id"] = [district_id(s, n) for s, n in zip(districts.state, districts.number)]

    out = districts[["id", "state", "number", "metro", "metro_share", "geometry"]]
    out = out.sort_values("id").to_crs(4326)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_file(OUT, driver="GeoJSON")

    print(f"Wrote {len(out)} districts to {OUT.relative_to(ROOT)}")
    print("Metro:", ", ".join(out[out.metro].id))


if __name__ == "__main__":
    main()
