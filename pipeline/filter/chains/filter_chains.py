"""Layer 1 of the small-business filter: drop big chains.

A business is a chain if either:
  - OSM tags it with `brand` or `brand:wikidata`, or
  - its name matches a brand in the Name Suggestion Index (NSI) that operates
    in the US, in the same kind of business. NSI is OpenStreetMap's community
    list of chain brands.

"Same kind" means the same OSM category or the same category family below.
Without it, a local auto body shop called "Body Shop" matched The Body Shop
(cosmetics), and restaurants matched Marshalls and European Wax Center.
Exact category alone is too strict: OSM and NSI often disagree on
restaurant vs fast_food, tyres vs car_repair, and similar.

Only NSI brands that operate in our area count: nationwide, worldwide, or a
region that covers DC, Maryland or Virginia. A regional chain elsewhere
("ABC (Hawaii)", New England's "Market Basket") does not knock out a local
DMV shop with the same name.

A short list of generic names is never matched by name ("China Wok",
"Joe's Pizza"): most shops with those names are unrelated local businesses.
Layer 2 (national location count) decides those instead.

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

# NSI location codes that cover our area: US, continental US, the world,
# the Americas, Northern America, and regions inside DC/MD/VA
AREA_LOCATIONS = {"us", "conus", "001", "019", "021", "us-baltimore_and_dc.geojson"}
AREA_STATE_PREFIXES = ("us-dc", "us-md", "us-va")

# Normalized names too common to mean a specific chain
GENERIC_NAMES = {
    "chinawok", "joespizza", "minimart", "lucky", "bravo", "dig", "aroma",
    "liberty", "bambu", "holidayhair", "marketbasket", "dirtcheap",
}

# Categories close enough that a brand match across them still means a chain.
# A category may sit in more than one family.
CATEGORY_FAMILIES = [
    {"amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=ice_cream",
     "amenity=bar", "amenity=pub", "shop=bakery", "shop=coffee", "shop=deli",
     "shop=confectionery", "shop=pastry"},
    {"shop=convenience", "amenity=fuel", "shop=kiosk", "shop=supermarket",
     "shop=alcohol", "shop=variety_store"},
    {"shop=supermarket", "amenity=pharmacy", "shop=chemist", "shop=health_food",
     "shop=nutrition_supplements"},
    {"shop=car_repair", "shop=tyres", "shop=car", "shop=car_parts", "amenity=fuel"},
    {"shop=beauty", "shop=hairdresser", "shop=cosmetics", "shop=massage", "shop=perfumery"},
    {"shop=doityourself", "shop=hardware", "shop=garden_centre", "shop=tiles",
     "shop=interior_decoration", "shop=furniture", "shop=paint", "shop=trade",
     "shop=houseware"},
    {"shop=clothes", "shop=shoes", "shop=fashion_accessories", "shop=sports",
     "shop=department_store", "shop=boutique"},
    {"shop=copyshop", "shop=stationery", "shop=shipping", "amenity=post_office"},
    {"shop=dry_cleaning", "shop=laundry"},
]


def normalize(name: str) -> str:
    name = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    name = re.sub(r"^the\s+", "", name)
    return re.sub(r"[^a-z0-9]+", "", name)


def operates_in_area(item: dict) -> bool:
    for location in item.get("locationSet", {}).get("include", []):
        if not isinstance(location, str):
            continue
        location = location.lower()
        if location in AREA_LOCATIONS or location.startswith(AREA_STATE_PREFIXES):
            return True
    return False


def same_kind(category: str, brand_category: str) -> bool:
    if category == brand_category:
        return True
    return any(category in family and brand_category in family for family in CATEGORY_FAMILIES)


def load_nsi_brands() -> dict[str, dict[str, str]]:
    """Map normalized brand name -> {OSM category: display name}, for brands in our area."""
    if not NSI_PATH.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(NSI_URL, headers={"User-Agent": "md08-local-map/0.1"})
        with urllib.request.urlopen(request) as response:
            NSI_PATH.write_bytes(response.read())

    brands = {}
    for key, entry in json.loads(NSI_PATH.read_text())["nsi"].items():
        if not key.startswith("brands/"):
            continue
        brand_category = "=".join(key.split("/")[1:3])  # "brands/shop/tyres" -> "shop=tyres"
        for item in entry["items"]:
            if not operates_in_area(item):
                continue
            tags = item["tags"]
            names = [item["displayName"], tags.get("name"), tags.get("brand")]
            names += item.get("matchNames", [])
            for name in filter(None, names):
                key_name = normalize(name)
                # skip names too short or too generic to match safely
                if len(key_name) >= 3 and key_name not in GENERIC_NAMES:
                    brands.setdefault(key_name, {}).setdefault(brand_category, item["displayName"])
    return brands


def chain_reason(row, brands: dict[str, dict[str, str]]) -> str | None:
    for tag in ("brand", "brand:wikidata"):
        value = row.get(tag)
        if isinstance(value, str) and value:
            return f"OSM {tag} tag"
    name = row.get("name")
    if not isinstance(name, str):
        return None
    for brand_category, display_name in brands.get(normalize(name), {}).items():
        if same_kind(row["category"], brand_category):
            return f"NSI brand: {display_name}"
    return None


def main() -> None:
    brands = load_nsi_brands()
    businesses = gpd.read_file(IN)

    businesses["chain_reason"] = [chain_reason(row, brands) for _, row in businesses.iterrows()]
    businesses["chain"] = businesses.chain_reason.notna()
    businesses.to_file(OUT, driver="GeoJSON")

    chains = businesses[businesses.chain]
    print(f"NSI brand names loaded (our area): {len(brands)}")
    print(f"Businesses: {len(businesses)}, chains: {len(chains)}, not chains: {len(businesses) - len(chains)}")
    by_tag = chains.chain_reason.str.startswith("OSM").sum()
    print(f"  caught by OSM brand tag: {by_tag}, caught only by NSI name: {len(chains) - by_tag}")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
