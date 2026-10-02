"""Layer 1 of the small-business filter: drop big chains.

A business is a chain if either:
  - OSM tags it with `brand` or `brand:wikidata`, or
  - its name matches a brand in the Name Suggestion Index (NSI) that operates
    in the US. NSI is OpenStreetMap's community list of chain brands.

Only US (or worldwide) NSI brands are used, so a foreign chain that happens to
share a name with a local shop does not knock the local shop out.

Input:  data/processed/businesses.geojson
Output: data/processed/businesses_layer1.geojson
        (every business, with `chain` true/false and `chain_reason`)
Run from repo root: .venv/bin/python pipeline/filter/chains/filter_chains.py
"""

from pathlib import Path
import json
import re
import urllib.request

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "raw"
IN = ROOT / "data" / "processed" / "businesses.geojson"
OUT = ROOT / "data" / "processed" / "businesses_layer1.geojson"

NSI_URL = "https://cdn.jsdelivr.net/npm/name-suggestion-index@latest/dist/nsi.min.json"
NSI_PATH = RAW / "nsi.json"

# NSI location codes that cover our area: US, continental US, the world
US_LOCATIONS = {"us", "conus", "001"}


def normalize(name: str) -> str:
    name = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    name = re.sub(r"^the\s+", "", name)
    return re.sub(r"[^a-z0-9]+", "", name)


def operates_in_us(item: dict) -> bool:
    for location in item.get("locationSet", {}).get("include", []):
        if isinstance(location, str) and (location in US_LOCATIONS or location.startswith("us-")):
            return True
    return False


def load_nsi_brands() -> dict[str, str]:
    """Map normalized brand name -> display name, for US brands."""
    if not NSI_PATH.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(NSI_URL, headers={"User-Agent": "md08-local-map/0.1"})
        with urllib.request.urlopen(request) as response:
            NSI_PATH.write_bytes(response.read())

    brands = {}
    for key, entry in json.loads(NSI_PATH.read_text())["nsi"].items():
        if not key.startswith("brands/"):
            continue
        for item in entry["items"]:
            if not operates_in_us(item):
                continue
            tags = item["tags"]
            names = [item["displayName"], tags.get("name"), tags.get("brand")]
            names += item.get("matchNames", [])
            for name in filter(None, names):
                key_name = normalize(name)
                if len(key_name) >= 3:  # skip names too short to match safely
                    brands.setdefault(key_name, item["displayName"])
    return brands


def chain_reason(row, brands: dict[str, str]) -> str | None:
    for tag in ("brand", "brand:wikidata"):
        value = row.get(tag)
        if isinstance(value, str) and value:
            return f"OSM {tag} tag"
    name = row.get("name")
    if isinstance(name, str) and normalize(name) in brands:
        return f"NSI brand: {brands[normalize(name)]}"
    return None


def main() -> None:
    brands = load_nsi_brands()
    businesses = gpd.read_file(IN)

    businesses["chain_reason"] = [chain_reason(row, brands) for _, row in businesses.iterrows()]
    businesses["chain"] = businesses.chain_reason.notna()
    businesses.to_file(OUT, driver="GeoJSON")

    chains = businesses[businesses.chain]
    print(f"NSI US brand names loaded: {len(brands)}")
    print(f"Businesses: {len(businesses)}, chains: {len(chains)}, not chains: {len(businesses) - len(chains)}")
    by_tag = chains.chain_reason.str.startswith("OSM").sum()
    print(f"  caught by OSM brand tag: {by_tag}, caught only by NSI name: {len(chains) - by_tag}")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
