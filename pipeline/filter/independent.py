"""Decide which businesses are small and independent.

The rule (team decision): keep businesses with two or fewer locations in
the whole US; drop chains. This module decides it with one algorithm:

1. Normalise every business's identity: name, website domain, phone,
   email, social handles, operator, brand id.
2. Build a graph. Two businesses are linked when they share a strong
   identity (same phone, email, social handle, operator or brand id; same
   website domain with a word of the name in common), or the same name when
   that name is *distinctive*. A name is distinctive when most uses of one
   of its words come from that exact name: "Kusshi" appears only as Kusshi,
   so five Kusshis are one business; "Golden" and "Dragon" appear in dozens
   of unrelated names, so five Golden Dragons stay five businesses. Name
   links also need the same map group (Great Wall the supermarket is not
   Great Wall the restaurant) and no two different websites among them.
3. Each connected part of the graph is one business entity. Its locations
   are its members more than LOCATION_METERS apart (a shop mapped twice as a
   point and a building is one location).
4. An entity is a chain when any of these hold:
   - LOCATIONS_FOR_CHAIN or more locations in our area;
   - a member carries a brand:wikidata id (only notable brands have one);
   - its name matches a Name Suggestion Index brand sold in the US, in the
     same map group (a "Body Shop" auto body is not The Body Shop);
   - a member has a brand tag and the entity has 2+ locations.
5. Places run by an institution are not independent either: a university,
   museum or government website (.edu, .gov, .mil) or a contractor's
   (Sodexo, Barnes & Noble College...), or such an operator tag.
6. A website that is a chain's store locator (a store number, or state and
   city folders after /locations/) means a chain, even with 1-2 stores here.
7. Everything else that is a named, real business is small. Vape shops are
   left out entirely (team decision for the school demo), and so are smoke
   shops: tobacco shops except cigar shops and tobacconists.

Input:  data/processed/businesses.geojson, data/raw/nsi.json
Output: data/processed/small_businesses.geojson   (the businesses the site shows)
        data/processed/business_decisions.csv     (every business: entity, locations, decision, reason)
Run from repo root: .venv/bin/python pipeline/filter/independent.py
"""

from collections import Counter, defaultdict
from pathlib import Path
import json
import math
import re
from urllib.parse import urlparse

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
NSI_PATH = ROOT / "data" / "raw" / "nsi.json"

LOCATIONS_FOR_CHAIN = 3
LOCATION_METERS = 60
# A word is "owned" by a name when the name accounts for at least this share of the word's uses
OWNED_SHARE = 0.5

# Hosts that many unrelated businesses share; the first path part names the business there
SHARED_HOSTS = {
    "facebook.com", "instagram.com", "linktr.ee", "yelp.com", "toasttab.com", "order.online",
    "sites.google.com", "google.com", "business.site", "squareup.com", "square.site", "clover.com",
    "grubhub.com", "doordash.com", "ubereats.com", "seamless.com", "menufy.com", "beyondmenu.com",
    "tiktok.com", "x.com", "twitter.com", "linkedin.com", "youtube.com", "wixsite.com", "weebly.com",
    "godaddysites.com", "myshopify.com", "vagaro.com", "booksy.com", "styleseat.com", "schedulicity.com",
}
FREE_EMAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "comcast.net", "verizon.net", "msn.com", "live.com"}
# NSI regions that cover DC, Maryland or Virginia
US_REGIONS = {"001", "019", "021", "us", "us-dc", "us-md", "us-va", "us-dc.geojson", "us-md.geojson", "us-va.geojson"}

# Places that aren't open businesses, or that hold other businesses
NOT_BUSINESSES = {
    "shop=vacant", "shop=yes", "shop=mall", "shop=no", "shop=disused", "amenity=vending_machine",
    "amenity=parcel_locker", "amenity=atm", "shop=outpost", "amenity=marketplace", "amenity=food_court",
}
# Run by a university, museum, government or their contractor: not an independent business.
# Seen in the data: campus dining (dining.gwu.edu, gmu.sodexomyway.com), Smithsonian cafes (si.edu),
# college bookstores (nvcc.bncollege.com).
INSTITUTION_HOSTS = re.compile(
    r"\.(edu|gov|mil)$|sodexo|aramark|dineoncampus|bncollege|bkstr|follett|compass-usa|restaurantassociates",
    re.IGNORECASE,
)
INSTITUTION_OPERATORS = re.compile(
    r"universit|college|smithsonian|national park|sodexo|aramark|compass group|barnes & noble college|follett|"
    r"restaurant associates|thompson hospitality|\bcounty\b|city of|government|public schools",
    re.IGNORECASE,
)
VAPE_CATEGORY = "shop=e-cigarette"
VAPE_NAME = re.compile(r"\bvap(e|or|ing)s?\b", re.IGNORECASE)
# Most "tobacco" shops here are smoke and vape shops ("Smoke Hut", "Tobacco Plus: vape, CBD, kratom").
# Cigar shops and tobacconists stay; plain cannabis dispensaries stay (team decision).
SMOKE_SHOP_NAME = re.compile(r"\b(smoke|vap|hookah|kratom|cbd|e-?cig|juul|head ?shop|glass)", re.IGNORECASE)
CIGAR_SHOP_NAME = re.compile(r"cigar(?!ette)|tobacconist", re.IGNORECASE)
# A chain's store locator: a store number, or state/city folders, after /locations/ or /stores/
# (thecapitalgrille.com/locations/dc/washington/washington-dc/8003, cellphonerepair.com/locations/store/cpr-falls-church-va-901034)
STORE_LOCATOR = re.compile(
    # the number ends a path segment ("/56500", "-901034"); a leading street number ("/13838-outlet-dr") doesn't count
    r"/(locations?|stores?|store-locator|restaurants|branch(es)?|dealers?)/"
    r"(?:[^?#]*?[/-]\d{3,}(?:[/?#.]|$)|[a-z]{2}/[^/?#]+/)",
    re.IGNORECASE,
)

# Map groups: what a visitor is looking for, not how OSM files it
GROUPS = {
    "food": {
        "amenity": {"restaurant", "fast_food", "cafe", "bar", "pub", "ice_cream", "biergarten", "food_court"},
        "shop": {"bakery", "pastry", "coffee", "tea", "confectionery", "chocolate", "deli", "ice_cream", "bubble_tea", "cheese", "dairy"},
        "craft": {"brewery", "winery", "distillery", "caterer", "confectionery"},
    },
    "groceries": {
        "amenity": {"pharmacy"},
        "shop": {"convenience", "supermarket", "grocery", "greengrocer", "butcher", "seafood", "alcohol", "wine", "beverages",
                 "farm", "health_food", "spices", "frozen_food", "food", "country_store", "chemist", "nutrition_supplements",
                 "variety_store", "general", "kiosk", "water", "pasta", "rice"},
    },
    "personal_care": {
        "shop": {"hairdresser", "beauty", "cosmetics", "massage", "tattoo", "piercing", "optician", "perfumery",
                 "hairdresser_supply", "hearing_aids", "medical_supply", "herbalist"},
        "amenity": {"spa"},
    },
    "services": {
        "shop": {"dry_cleaning", "laundry", "car_repair", "tyres", "copyshop", "tailor", "shoe_repair", "repair", "locksmith",
                 "pet_grooming", "funeral_directors", "travel_agency", "storage_rental", "money_lender", "pawnbroker",
                 "rental", "car_wash", "photo", "printing", "estate_agent", "insurance", "ticket", "mobile_phone_repair"},
        "amenity": {"car_wash", "veterinary", "driving_school", "dentist", "doctors", "clinic", "childcare", "bureau_de_change"},
    },
}


def group_of(category: str) -> str | None:
    """Map group for "key=value"; any other shop is Shopping, any other trade (craft) is Services."""
    key, _, value = category.partition("=")
    for group, by_key in GROUPS.items():
        if value in by_key.get(key, set()):
            return group
    if key == "shop":
        return "shopping"
    if key == "craft":
        return "services"
    return None


# ---------------------------------------------------------------- identity


def clean(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def first_value(value: str) -> str:
    return value.split(";")[0].strip()


def normalize_name(name: str, towns: set[str]) -> str:
    text = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    text = re.sub(r"#\s*\d+|\bno\.?\s*\d+\b|\bstore\s+\d+\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    words = text.split()
    # "Kusshi Bethesda", "Kusshi - Rockville", "Taqueria of Wheaton" → the business, not the place
    while len(words) > 1 and words[-1] in towns:
        words.pop()
        if len(words) > 1 and words[-1] in {"of", "at", "in"}:
            words.pop()
    return " ".join(words)


def website_key(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url if "://" in url else f"http://{url}")
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if not host:
        return ""
    for shared in SHARED_HOSTS:
        if host == shared or host.endswith(f".{shared}"):
            if host != shared:
                return host  # their own subdomain on a builder: theirs alone
            part = parsed.path.strip("/").split("/")[0].lower()
            return f"{host}/{part}" if part else ""
    return host


def phone_key(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return digits[-10:] if len(digits) >= 10 else ""


def email_key(email: str) -> str:
    email = email.lower().strip()
    return email if "@" in email else ""


def handle_key(prefix: str, value: str) -> str:
    value = value.strip().lower()
    if not value:
        return ""
    parsed = urlparse(value if "://" in value or "." in value.split("/")[0] else f"https://x/{value}")
    path = parsed.path.strip("/")
    if path.endswith("profile.php"):
        # facebook.com/profile.php?id=123: the id is the page, not "profile.php"
        page = re.search(r"(?:^|&)id=(\d+)", parsed.query)
        handle = page.group(1) if page else ""
    else:
        handle = path.split("/")[-1].lstrip("@") if path else ""
    return f"{prefix}:{handle}" if handle else ""


def meters(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111_320 * math.cos(lat), (a[1] - b[1]) * 110_540)


class UnionFind:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, item: int) -> int:
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def load_nsi_names() -> dict[str, set[str]]:
    """Normalised brand name → map groups it is sold as, for brands present in the US."""
    names: dict[str, set[str]] = defaultdict(set)
    for path, entry in json.loads(NSI_PATH.read_text())["nsi"].items():
        parts = path.split("/")
        if parts[0] != "brands" or len(parts) < 3:
            continue
        group = group_of(f"{parts[1]}={parts[2]}")
        if group is None:
            continue
        for item in entry.get("items", []):
            regions = {region.lower() if isinstance(region, str) else "" for region in item.get("locationSet", {}).get("include", [])}
            if not regions & US_REGIONS:
                continue
            tags = item.get("tags", {})
            for name in {tags.get("brand", ""), tags.get("name", ""), *item.get("matchNames", [])}:
                key = normalize_name(name, set())
                if key:
                    names[key].add(group)
    return names


# ---------------------------------------------------------------- the algorithm


def decide(businesses: gpd.GeoDataFrame, nsi: dict[str, set[str]]) -> pd.DataFrame:
    # Town words, so "Kusshi Silver Spring" reads as Kusshi
    towns = {word for city in businesses["addr:city"].dropna() for word in city.lower().split() if len(word) > 3}

    rows = []
    for tags, geometry in zip(businesses.drop(columns="geometry").to_dict("records"), businesses.geometry):
        name = clean(tags["name"])
        category = first_value(clean(tags["category"]))
        rows.append(
            {
                "osm_id": tags["osm_id"],
                "name": name,
                "category": category,
                "group": group_of(category),
                "key": normalize_name(name, towns) if name else "",
                "point": (geometry.x, geometry.y),
                "brand": clean(tags["brand"]),
                "host": website_key(clean(tags["website"]) or clean(tags["contact:website"])).split("/")[0],
                "url": clean(tags["website"]) or clean(tags["contact:website"]),
                "operator": clean(tags["operator"]),
                "wikidata": clean(tags["brand:wikidata"]),
                "identities": [
                    key
                    for key in (
                        "web:" + website_key(clean(tags["website"]) or clean(tags["contact:website"])),
                        "phone:" + phone_key(clean(tags["phone"]) or clean(tags["contact:phone"])),
                        "email:" + email_key(clean(tags["email"])),
                        handle_key("ig", clean(tags["contact:instagram"])),
                        handle_key("fb", clean(tags["contact:facebook"])),
                        "op:" + clean(tags["operator"]).lower(),
                        "wd:" + clean(tags["brand:wikidata"]),
                    )
                    if key and not key.endswith(":")
                ],
            }
        )
    table = pd.DataFrame(rows)
    words_of = [set(key.split()) for key in table.key]

    # Which words does each name own? (most uses of the word come from that exact name)
    word_uses = Counter(word for words in words_of for word in words)
    name_uses = Counter(table.key)
    owned = {
        key: [word for word in key.split() if len(word) > 2 and name_uses[key] / word_uses[word] >= OWNED_SHARE]
        for key in name_uses
        if key
    }
    distinctive = {key for key, words in owned.items() if words}

    graph = UnionFind(len(table))
    holders: dict[str, list[int]] = defaultdict(list)
    for index, identities in enumerate(table.identities):
        for identity in identities:
            holders[identity].append(index)
    links = Counter()
    for identity, members in holders.items():
        kind = identity.split(":")[0]
        for other in members[1:]:
            first = members[0]
            # A shared website or phone can be a mall or an office switchboard: the names must share a word
            if kind in {"web", "phone"} and not (words_of[first] & words_of[other]):
                if kind == "phone" or not any(word in identity for word in words_of[other] if len(word) > 3):
                    continue
            graph.union(first, other)
            links[kind] += 1
    # Same distinctive name, same map group, and no sign they are different businesses.
    # Different websites are a sign, unless every one carries the name's own word
    # (mobydickhouse.com and mobydickkabob.com are one brand).
    by_name: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, (key, group) in enumerate(zip(table.key, table.group)):
        if key in distinctive:
            by_name[(key, group)].append(index)
    for (key, _), members in by_name.items():
        websites = {identity for index in members for identity in table.identities[index] if identity.startswith("web:")}
        if len(websites) > 1 and not all(any(word in site for word in owned[key]) for site in websites):
            continue
        for other in members[1:]:
            graph.union(members[0], other)
            links["name"] += 1

    table["entity"] = [graph.find(index) for index in range(len(table))]
    locations: dict[int, int] = {}
    for entity, members in table.groupby("entity").groups.items():
        kept: list[tuple[float, float]] = []
        for point in table.loc[members, "point"]:
            if all(meters(point, other) > LOCATION_METERS for other in kept):
                kept.append(point)
        locations[entity] = len(kept)
    table["locations"] = table.entity.map(locations)

    entity_wikidata = table.groupby("entity").wikidata.agg(lambda values: any(values))
    entity_brand = table.groupby("entity").brand.agg(lambda values: any(values))

    def verdict(row) -> tuple[bool, str]:
        if not row["name"]:
            return False, "no name"
        if row["category"] in NOT_BUSINESSES or row["group"] is None:
            return False, "not a business"
        if row["category"] == VAPE_CATEGORY or VAPE_NAME.search(row["name"]) or VAPE_NAME.search(row["url"]):
            return False, "vape shop"
        if row["category"] == "shop=tobacco" and not CIGAR_SHOP_NAME.search(row["name"]):
            return False, "vape shop (smoke shop)"
        if SMOKE_SHOP_NAME.search(row["name"]) and row["group"] == "shopping" and "tobacco" in row["category"]:
            return False, "vape shop (smoke shop)"
        if INSTITUTION_HOSTS.search(row["host"]) or INSTITUTION_OPERATORS.search(row["operator"]):
            return False, "run by an institution (university, museum, government or contractor)"
        if row["locations"] >= LOCATIONS_FOR_CHAIN:
            return False, f"chain: {row['locations']} locations here"
        if entity_wikidata[row["entity"]]:
            return False, "chain: brand with a Wikidata id"
        if row["group"] in nsi.get(row["key"], set()):
            return False, "chain: US brand in the Name Suggestion Index"
        if entity_brand[row["entity"]] and row["locations"] >= 2:
            return False, "chain: brand tag, 2 locations"
        if STORE_LOCATOR.search(row["url"]):
            return False, "chain: website is a chain store locator"
        return True, f"independent: {row['locations']} location{'s' if row['locations'] > 1 else ''}"

    verdicts = table.apply(verdict, axis=1, result_type="expand")
    table["independent"], table["reason"] = verdicts[0], verdicts[1]
    print("Graph links:", dict(links))
    print(f"Distinctive names: {len(distinctive)} of {len(name_uses)}")
    return table


def main() -> None:
    businesses = gpd.read_file(PROCESSED / "businesses.geojson")
    decisions = decide(businesses, load_nsi_names())

    small = businesses.set_index("osm_id").loc[decisions.osm_id[decisions.independent]].reset_index()
    small["category"] = small.category.map(lambda value: first_value(clean(value)))
    small["group"] = small.category.map(group_of)
    small = small.drop(columns=["brand", "brand:wikidata"], errors="ignore")
    small.to_file(PROCESSED / "small_businesses.geojson", driver="GeoJSON")
    decisions[["osm_id", "name", "category", "group", "entity", "locations", "independent", "reason"]].to_csv(
        PROCESSED / "business_decisions.csv", index=False
    )

    print(f"All businesses: {len(decisions)}")
    reasons = decisions.reason.str.replace(r": \d+ locations? here", ": 3+ locations here", regex=True)
    reasons = reasons.str.replace(r"independent: \d+ locations?", "independent", regex=True)
    print(reasons.value_counts().to_string())
    print(small.group.value_counts().to_string())


if __name__ == "__main__":
    main()
