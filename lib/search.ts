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
}

type Row = [string, string, string, GroupId, string, string, string, number, number];

let index: Promise<SearchEntry[]> | null = null;

/** Loads the search index once, on first use. */
export function loadSearchIndex(): Promise<SearchEntry[]> {
  index ??= fetch("/data/search.json")
    .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
    .then(({ rows }: { rows: Row[] }) =>
      rows.map(([id, name, district, group, category, street, city, lng, lat]) => ({
        id, name, district, group, category, street, city, lng, lat,
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

/**
 * Best matches for a query, by name first, then street or city.
 * Ranking: name starts with the query, then a word in the name starts with
 * it, then the name contains it, then the address does. Ties prefer the
 * current district.
 */
export function search(entries: SearchEntry[], query: string, currentDistrict: string, limit = 8): SearchEntry[] {
  const q = normalize(query);
  if (q.length < 2) return [];

  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const name = normalize(entry.name);
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(` ${q}`)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (normalize(`${entry.street} ${entry.city}`).includes(q)) score = 3;
    else continue;
    if (entry.district !== currentDistrict) score += 0.5;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map((s) => s.entry);
}
