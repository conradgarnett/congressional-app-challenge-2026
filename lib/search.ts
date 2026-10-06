import { tagLabel } from "@/lib/tags";
import type { GroupId } from "@/types/business";

/** One business in public/data/search.json (written by pipeline/load/export_site_data.py). */
export interface SearchEntry {
  id: string;
  name: string;
  district: string;
  group: GroupId;
  category: string;
  street: string;
  city: string;
  lng: number;
  lat: number;
  tags: string[];
}

type Row = [string, string, string, GroupId, string, string, string, number, number, string];

let index: Promise<SearchEntry[]> | null = null;

/** Loads the search index once, on first use. */
export function loadSearchIndex(): Promise<SearchEntry[]> {
  index ??= fetch("/data/search.json")
    .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
    .then(({ rows }: { rows: Row[] }) =>
      rows.map(([id, name, district, group, category, street, city, lng, lat, tags]) => ({
        id, name, district, group, category, street, city, lng, lat,
        tags: tags ? tags.split(";") : [],
      })),
    )
    .catch((error) => {
      index = null; // let the next attempt retry
      throw error;
    });
  return index;
}

/** Lowercase, strip accents and punctuation: "Café Nell’s" -> "cafe nells" */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words people add around a type: "pizza place", "chinese food", "coffee shops near me" */
const FILLER_WORDS = new Set([
  "food", "foods", "place", "places", "restaurant", "restaurants", "shop", "shops",
  "store", "stores", "spot", "spots", "joint", "near", "me", "nearby", "best", "good",
]);

/** Everyday words -> tag ids */
const SYNONYMS: Record<string, string> = {
  // Most coffee spots are OSM amenity=cafe; few carry cuisine=coffee_shop
  coffee: "cafe",
  espresso: "cafe",
  boba: "bubble_tea",
  taco: "mexican",
  tacos: "mexican",
  burrito: "mexican",
  burgers: "burger",
  wings: "chicken",
  bbq: "barbecue",
  noodles: "ramen",
  donuts: "donut",
  doughnut: "donut",
  bagels: "bagel",
  subs: "sandwich",
  sandwiches: "sandwich",
  deli: "sandwich",
  pastry: "bakery",
  pastries: "bakery",
  cake: "bakery",
  gelato: "ice_cream",
  haircut: "hairdresser",
  hair: "hairdresser",
  salon: "hairdresser",
  barbershop: "barber",
  nail: "nails",
  manicure: "nails",
  mechanic: "car_repair",
  tires: "tyres",
  tire: "tyres",
  liquor: "alcohol",
  wine: "alcohol",
  beer: "alcohol",
  thrift: "second_hand",
  secondhand: "second_hand",
  groceries: "supermarket",
  grocery: "supermarket",
  takeout: "takeout",
  carryout: "takeout",
  wifi: "wifi",
  wheelchair: "wheelchair_accessible",
  accessible: "wheelchair_accessible",
  vegetarian: "vegetarian",
  laundromat: "laundry",
  pharmacy: "pharmacy",
  drugstore: "pharmacy",
  flowers: "florist",
  comics: "games",
};

/**
 * The tag a query names, if any: "pizza", "Pizza place", "chinese food",
 * "coffee", "take out". Only tags that exist in the data count.
 */
export function queryTag(query: string, knownTags: Set<string>): string | null {
  const words = normalize(query).split(" ").filter((word) => word && !FILLER_WORDS.has(word));
  if (words.length === 0) return null;
  const core = words.join(" ");
  // Synonyms first: "coffee" means cafes, even though a few places carry a raw "coffee" tag
  const candidates = [
    SYNONYMS[core.replace(/ /g, "")], // "take out" -> takeout
    SYNONYMS[core],
    core.replace(/ /g, "_"), // "ice cream" -> ice_cream
    core.endsWith("s") ? core.slice(0, -1).replace(/ /g, "_") : undefined, // "bakeries" stays, "pizzas" -> pizza
  ];
  return candidates.find((tag): tag is string => !!tag && knownTags.has(tag)) ?? null;
}

let knownTagsCache: { entries: SearchEntry[]; tags: Set<string> } | null = null;
function knownTags(entries: SearchEntry[]): Set<string> {
  if (knownTagsCache?.entries !== entries) {
    knownTagsCache = { entries, tags: new Set(entries.flatMap((entry) => entry.tags)) };
  }
  return knownTagsCache.tags;
}

export interface TagMatch {
  tag: string;
  label: string;
  /** Businesses with the tag in the current district, in `group` */
  count: number;
  /** The map group most of them are in, for the "show all" action */
  group: GroupId;
}

export interface SearchResults {
  tagMatch: TagMatch | null;
  entries: SearchEntry[];
}

/**
 * Best matches for a query. Ranking:
 *   0  has the tag the query names ("pizza" -> every pizza place)
 *   1  name starts with the query
 *   2  a word in the name starts with it
 *   3  the name contains it
 *   4  the street or city contains it
 * Ties prefer the current district, then alphabetical.
 */
export function search(entries: SearchEntry[], query: string, currentDistrict: string, limit = 8): SearchResults {
  const q = normalize(query);
  if (q.length < 2) return { tagMatch: null, entries: [] };
  const tag = queryTag(query, knownTags(entries));

  const scored: { entry: SearchEntry; score: number }[] = [];
  const groupCounts = new Map<GroupId, number>();
  for (const entry of entries) {
    const name = normalize(entry.name);
    let score: number;
    if (tag && entry.tags.includes(tag)) {
      score = 0;
      if (entry.district === currentDistrict) groupCounts.set(entry.group, (groupCounts.get(entry.group) ?? 0) + 1);
    } else if (name.startsWith(q)) score = 1;
    else if (name.includes(` ${q}`)) score = 2;
    else if (name.includes(q)) score = 3;
    else if (normalize(`${entry.street} ${entry.city}`).includes(q)) score = 4;
    else continue;
    if (entry.district !== currentDistrict) score += 0.5;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));

  let tagMatch: TagMatch | null = null;
  if (tag && groupCounts.size > 0) {
    const [group, count] = [...groupCounts].sort((a, b) => b[1] - a[1])[0];
    tagMatch = { tag, label: tagLabel(tag), count, group };
  }
  return { tagMatch, entries: scored.slice(0, limit).map((s) => s.entry) };
}
