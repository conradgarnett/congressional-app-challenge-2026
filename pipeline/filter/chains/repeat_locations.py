"""Layer 1b of the chain filter: our own location count.

Brand tags and the Name Suggestion Index miss regional chains: Kusshi,
Moby Dick House of Kabob, Lebanese Taverna, Glory Days Grill... Our rule is
"small business = 2 or fewer locations", so count locations ourselves across
every district we pulled.

A business is a chain here if either:
  1. Its brand name appears 3+ times across the pulled districts. The brand
     name is the name with a trailing town removed ("Kusshi Bethesda" ->
     "kusshi"). Names made only of generic words ("China King", "Food Mart",
     "Beer & Wine") are skipped: those are usually unrelated family
     businesses sharing a common name (the "Golden Dragon" problem).
  2. 3+ businesses share one website whose address contains their name
     (bibibop.com for "Bibibop"). Requiring the name keeps out hosts that
     list many unrelated businesses: a mall's site, a food hall, nps.gov.

Limits: only counts locations inside the districts we pulled. A chain with
1-2 locations here but many elsewhere still needs layer 2 (national check).
"""

import re
from collections import Counter
from urllib.parse import urlparse

import pandas as pd

MIN_LOCATIONS = 3

GENERIC_WORDS = {
    # food
    "china", "chinese", "king", "express", "garden", "house", "hong", "kong", "hunan",
    "szechuan", "sichuan", "wok", "golden", "dragon", "panda", "star", "new", "great",
    "wall", "cafe", "restaurant", "grill", "kitchen", "pizza", "pizzeria", "deli",
    "bakery", "coffee", "tea", "sushi", "thai", "pho", "taqueria", "tacos", "mexican",
    "chicken", "wings", "bbq", "halal", "food", "foods", "bar", "pub", "diner", "bistro",
    # stores
    "market", "mart", "grocery", "international", "beer", "wine", "liquor", "liquors",
    "spirits", "convenience", "store", "shop", "smoke", "tobacco", "vape", "cigar",
    "cigars", "mini", "super", "general", "variety", "dollar",
    # services and care
    "nail", "nails", "spa", "salon", "beauty", "supply", "barber", "barbershop", "hair",
    "cuts", "auto", "repair", "tire", "tires", "service", "center", "cleaners", "dry",
    "cleaning", "laundry", "laundromat", "tailor", "tailoring", "club",
    # filler
    "the", "and", "of", "best", "quick", "family", "city", "town", "village", "plus",
    "one", "1", "2", "usa", "american", "us", "co", "inc", "llc",
}

# Website hosts that many unrelated businesses share
SHARED_HOSTS = (
    "facebook.com", "instagram.com", "yelp.com", "google.com", "goo.gl", "linktr.ee",
    "squarespace.com", "square.site", "wixsite.com", "wix.com", "toasttab.com",
    "toast.site", "godaddysites.com", "weebly.com", "business.site", "doordash.com",
    "grubhub.com", "ubereats.com", "clover.com", "menufy.com", "order.online",
    "beyondmenu.com", "chownow.com", "tripadvisor.com", "sites.google.com",
    "booksy.com", "vagaro.com", "styleseat.com", "schedulicity.com",
)


def words(text: str) -> list[str]:
    text = text.lower().replace("&", " and ").replace("'", "").replace("’", "")
    return re.findall(r"[a-z0-9]+", text)


def town_phrases(businesses: pd.DataFrame) -> set[tuple[str, ...]]:
    """Town names seen in addresses, as word tuples: ("silver", "spring")."""
    towns = businesses.get("addr:city", pd.Series(dtype=str)).dropna()
    return {tuple(words(town)) for town in towns if words(town)}


def brand_key(name: str, towns: set[tuple[str, ...]]) -> tuple[str, ...]:
    """'The Kusshi Bethesda' -> ('kusshi',). Strips a leading 'the' and one trailing town."""
    parts = words(name)
    if parts[:1] == ["the"]:
        parts = parts[1:]
    for size in (3, 2, 1):
        if len(parts) > size and tuple(parts[-size:]) in towns:
            parts = parts[:-size]
            break
    return tuple(parts)


def is_generic(key: tuple[str, ...]) -> bool:
    return all(word in GENERIC_WORDS for word in key)


def website_host(row) -> str | None:
    for column in ("website", "contact:website"):
        value = row.get(column)
        # Missing values can arrive as NaN or as the text "nan"
        if isinstance(value, str) and value.strip() and value.strip().lower() not in ("nan", "none"):
            url = value.strip() if "://" in value else f"https://{value.strip()}"
            host = (urlparse(url).hostname or "").lower().removeprefix("www.")
            if host and not any(host == h or host.endswith(f".{h}") for h in SHARED_HOSTS):
                return host
    return None


def host_matches_name(host: str, key: tuple[str, ...]) -> bool:
    """bibibop.com matches ('bibibop',); edencenter.com doesn't match ('pho', '75')."""
    squashed = host.replace("-", "").replace(".", "")
    if key and "".join(key) in squashed:
        return True
    return any(len(word) >= 4 and word not in GENERIC_WORDS and word in squashed for word in key)


def repeat_location_reasons(businesses: pd.DataFrame) -> pd.Series:
    """Chain reason for each business that layer 1b catches, else None."""
    towns = town_phrases(businesses)
    names = businesses["name"].where(businesses["name"].notna(), "")
    keys = names.map(lambda name: brand_key(name, towns) if name else ())
    hosts = [
        host if host and host_matches_name(host, key) else None
        # A plain loop: DataFrame.apply would turn None into NaN
        for host, key in zip([website_host(row) for _, row in businesses.iterrows()], keys)
    ]

    key_counts = Counter(key for key in keys if key)
    host_counts = Counter(host for host in hosts if host)

    reasons = []
    for key, host in zip(keys, hosts):
        if key and not is_generic(key) and key_counts[key] >= MIN_LOCATIONS:
            reasons.append(f"{key_counts[key]} locations in the DC area")
        elif host and host_counts[host] >= MIN_LOCATIONS:
            reasons.append(f"same website ({host}) at {host_counts[host]} locations")
        else:
            reasons.append(None)
    return pd.Series(reasons, index=businesses.index)
