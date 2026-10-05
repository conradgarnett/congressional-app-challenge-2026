"""Sort non-chain businesses into the five groups the map's tabs filter by.

Groups: food (Food & drink), groceries (Groceries & essentials),
personal_care (Personal care), services (Services), shopping (Shopping).
The map shows all groups by default; each tab narrows to one.

Dropped here, before any group is assigned:
  - chains (from layer 1)
  - places with no name: nothing to show on a pin
  - non-businesses: empty storefronts (shop=vacant), unknown type (shop=yes,
    craft=yes), malls and shopping centres (buildings that hold businesses,
    not businesses), parcel pickup points (shop=outpost), vending machines

Groups come from the OSM category. The lists below cover the common
categories; any other shop=* goes to shopping and any other craft=* (trades
like plumbers and roofers) goes to services. When OSM lists several values
("dry_cleaning;tailor"), the first one decides.

Input:  data/processed/businesses_layer1.geojson
Output: data/processed/small_businesses.geojson
Run from repo root: .venv/bin/python pipeline/filter/groups/assign_groups.py
"""

from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[3]
IN = ROOT / "data" / "processed" / "businesses_layer1.geojson"
OUT = ROOT / "data" / "processed" / "small_businesses.geojson"

NOT_BUSINESSES = {
    "shop=vacant", "shop=yes", "craft=yes", "shop=mall", "shop=shopping_centre",
    "shop=outpost", "shop=vending_machine",
}

GROUP_LABELS = {
    "food": "Food & drink",
    "groceries": "Groceries & essentials",
    "personal_care": "Personal care",
    "services": "Services",
    "shopping": "Shopping",
}

FOOD = {
    "amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=bar",
    "amenity=pub", "amenity=ice_cream", "shop=ice_cream", "shop=bakery",
    "shop=pastry", "shop=confectionery", "shop=chocolate", "shop=coffee",
    "shop=coffee_roasting", "shop=tea", "shop=deli", "craft=brewery",
    "craft=winery", "craft=distillery", "craft=caterer", "craft=confectionery",
}

GROCERIES = {
    "shop=supermarket", "shop=convenience", "shop=grocery", "shop=greengrocer",
    "shop=butcher", "shop=seafood", "shop=cheese", "shop=dairy", "shop=farm",
    "shop=alcohol", "shop=liquor_store", "shop=wine", "shop=beverages",
    "shop=health_food", "shop=spices", "shop=spices_and_teas", "shop=food",
    "shop=general", "shop=country_store", "shop=variety_store", "shop=kiosk",
    "shop=water", "shop=honey", "shop=tortilla", "shop=caviar", "shop=dry_food",
    "shop=snack", "shop=soda", "shop=nutrition_supplements", "shop=newsagent",
    "shop=newsstand", "amenity=pharmacy", "shop=chemist", "shop=medical_supply",
}

PERSONAL_CARE = {
    "shop=hairdresser", "shop=beauty", "shop=massage", "shop=tattoo",
    "shop=piercing", "shop=cosmetics", "shop=perfumery", "shop=nail",
    "shop=nails", "shop=nail_salon", "shop=salon", "shop=optician",
    "shop=hearing_aids", "shop=hairdresser_supply", "shop=wigs",
    "shop=herbalist", "shop=health",
}

SERVICES = {
    "shop=car_repair", "shop=tyres", "shop=dry_cleaning", "shop=dry_cleaners",
    "shop=laundry", "shop=tailor", "shop=shoe_repair", "shop=repair",
    "shop=locksmith", "shop=copyshop", "shop=storage_rental",
    "shop=funeral_directors", "shop=pet_grooming", "shop=travel_agency",
    "shop=money_lender", "shop=pawnbroker", "shop=rental", "shop=tool_hire",
    "shop=plant_hire", "shop=estate_agent", "shop=shipping", "shop=photo",
    "shop=mobile_phone_repair", "shop=phone_repair", "shop=towing",
    "shop=car_detail", "shop=truck_repair", "shop=motorcycle_repair",
    "shop=boat_repair", "shop=security", "shop=pest_control",
    "shop=animal_training", "shop=window_tinting", "shop=bookmaker",
    "shop=lottery", "shop=financial_services", "shop=psychic", "shop=tarot",
    "shop=groundskeeping", "shop=gold_buyer", "shop=remodeling",
    "shop=3d_printing", "shop=auctioneer", "shop=auction_house",
}


def first_value(category: str) -> str:
    key, _, value = category.partition("=")
    return f"{key}={value.split(';')[0].strip()}"


def group_for(category: str) -> str:
    if category in FOOD:
        return "food"
    if category in GROCERIES:
        return "groceries"
    if category in PERSONAL_CARE:
        return "personal_care"
    if category in SERVICES or category.startswith("craft="):
        return "services"
    return "shopping"


def main() -> None:
    businesses = gpd.read_file(IN)
    total = len(businesses)

    businesses = businesses[~businesses.chain]
    after_chains = len(businesses)

    businesses = businesses[businesses["name"].fillna("").str.strip() != ""]
    after_names = len(businesses)

    businesses = businesses.assign(category=businesses.category.map(first_value))
    businesses = businesses[~businesses.category.isin(NOT_BUSINESSES)]

    businesses["group"] = businesses.category.map(group_for)
    businesses = businesses.drop(columns=["chain", "chain_reason", "brand", "brand:wikidata"], errors="ignore")
    businesses.to_file(OUT, driver="GeoJSON")

    print(f"All businesses: {total}")
    print(f"  minus chains: {after_chains}")
    print(f"  minus unnamed: {after_names}")
    print(f"  minus non-businesses: {len(businesses)}")
    counts = businesses.pivot_table(index="district", columns="group", values="osm_id", aggfunc="count", fill_value=0)
    counts["total"] = counts.sum(axis=1)
    print(counts.to_string())
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
