"""Tags for each small business, from data already in OSM.

Three sources, all from the OSM download (no outside services):
  1. OSM cuisine and type: cuisine=pizza;italian, amenity=restaurant
  2. Words in the name, for places whose cuisine isn't tagged:
     "Taqueria El Sol" -> mexican, "Pho 75" -> vietnamese, "Joe's Barber" -> barber.
     Name rules only apply inside their own map group, so "Indian Spring
     Liquors" (groceries) never becomes an Indian restaurant.
  3. Feature details: takeout, delivery, outdoor seating, drive-through,
     wheelchair access, Wi-Fi, diet options (vegan, halal...).

Tag ids are lowercase with underscores ("ice_cream"). Feature tags are listed
in FEATURE_TAGS so the site can show them in their own section.
"""

import re

# 2. Name words -> tag, per map group. Checked as whole words, case-insensitive.
NAME_RULES = {
    "food": [
        (r"pizz(a|eria)", "pizza"),
        (r"taquer[ií]a|tacos?|burrito|cantina|mexican", "mexican"),
        (r"sushi", "sushi"),
        (r"pho|banh mi|vietnam\w*", "vietnamese"),
        (r"ramen", "ramen"),
        (r"thai", "thai"),
        (r"indian|tandoor\w*|masala|biryani", "indian"),
        (r"chinese|szechuan|sichuan|hunan|wok|dumplings?|dim sum", "chinese"),
        (r"korean|bulgogi", "korean"),
        (r"japanese|teriyaki|izakaya|hibachi", "japanese"),
        (r"italian|trattoria|ristorante|osteria|pasta", "italian"),
        (r"greek|gyros?|souvlaki", "greek"),
        (r"mediterranean|falafel|shawarma", "mediterranean"),
        (r"ethiopian", "ethiopian"),
        (r"peruvian|pollo a la brasa", "peruvian"),
        (r"salvadoran|pupusa\w*", "salvadoran"),
        (r"halal", "halal"),
        (r"bbq|barbe?cue|smokehouse", "barbecue"),
        (r"burgers?", "burger"),
        (r"wings?|fried chicken|chicken", "chicken"),
        (r"seafood|crab\w*|oysters?|fish", "seafood"),
        (r"deli|delicatessen|subs?|sandwich\w*", "sandwich"),
        (r"bagels?", "bagel"),
        (r"donuts?|doughnuts?", "donut"),
        (r"bakery|bakeshop|patisserie|boulangerie", "bakery"),
        # Not "cafe": many places named Cafe are full restaurants ("Cafe Vy")
        (r"coffee|espresso|roasters?", "coffee_shop"),
        (r"boba|bubble tea|tea house|teahouse", "bubble_tea"),
        (r"ice cream|gelato|creamery|frozen yogurt|froyo", "ice_cream"),
        (r"brewery|brewing|taproom", "brewery"),
        (r"vegan", "vegan"),
    ],
    "groceries": [
        (r"halal", "halal"),
        (r"latin\w*|latino|mercado|tienda", "latin_american"),
        (r"asian|oriental|h ?mart", "asian"),
        (r"farm(ers)? market|produce", "greengrocer"),
        (r"butcher|meats?", "butcher"),
        (r"wine|liquors?|spirits", "alcohol"),
    ],
    "personal_care": [
        (r"barber\w*", "barber"),
        (r"nails?", "nails"),
        (r"lash(es)?|brows?", "lashes_brows"),  # whole words: not "Brown's"
        (r"spa", "spa"),
        (r"braid\w*", "braiding"),
    ],
    "services": [
        (r"tires?|tyres?", "tyres"),
        (r"auto|mechanic\w*|transmission|body shop|collision", "car_repair"),
        (r"tailor\w*|alterations?", "tailor"),
        (r"cleaners|dry clean\w*", "dry_cleaning"),
        (r"laundr\w*|laundromat", "laundry"),
        (r"plumb\w*", "plumber"),
        (r"electric\w*", "electrician"),
    ],
    "shopping": [
        (r"thrift|consignment|resale", "second_hand"),
        (r"books?|bookstore", "books"),
        (r"florist|flowers?", "florist"),
        (r"bikes?|bicycles?|cycles?", "bicycle"),
        (r"games?|comics?", "games"),
        (r"antiques?", "antiques"),
    ],
}
COMPILED_NAME_RULES = {
    group: [(re.compile(rf"\b(?:{pattern})\b", re.IGNORECASE), tag) for pattern, tag in rules]
    for group, rules in NAME_RULES.items()
}

# 3. OSM detail tag and the values that mean yes -> feature tag
FEATURE_RULES = [
    ("takeaway", {"yes", "only"}, "takeout"),
    ("delivery", {"yes"}, "delivery"),
    ("outdoor_seating", {"yes"}, "outdoor_seating"),
    ("drive_through", {"yes"}, "drive_through"),
    ("wheelchair", {"yes"}, "wheelchair_accessible"),
    ("internet_access", {"yes", "wlan", "wifi"}, "wifi"),
    ("diet:vegan", {"yes", "only"}, "vegan"),
    ("diet:vegetarian", {"yes", "only"}, "vegetarian"),
    ("diet:halal", {"yes", "only"}, "halal"),
    ("diet:kosher", {"yes", "only"}, "kosher"),
    ("diet:gluten_free", {"yes", "only"}, "gluten_free"),
]
FEATURE_TAGS = sorted({tag for _, _, tag in FEATURE_RULES})


def normalize_tag(value: str) -> str:
    return re.sub(r"\s+", "_", value.strip().lower())


def text(row, key: str) -> str:
    value = row.get(key)
    return value if isinstance(value, str) else ""


def business_tags(row) -> list[str]:
    """Every tag for one business, in a stable order: cuisine, type, name, features."""
    tags: list[str] = []

    def add(tag: str) -> None:
        if tag and tag not in tags:
            tags.append(tag)

    for cuisine in text(row, "cuisine").split(";"):
        add(normalize_tag(cuisine))
    add(normalize_tag(text(row, "category").partition("=")[2]))

    name = text(row, "name")
    for pattern, tag in COMPILED_NAME_RULES.get(text(row, "group"), []):
        if pattern.search(name):
            add(tag)

    for key, yes_values, tag in FEATURE_RULES:
        if text(row, key).strip().lower() in yes_values:
            add(tag)
    return tags
