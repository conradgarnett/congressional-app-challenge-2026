import type { Business, BusinessCollection, GroupId } from "@/types/business";

/*
 * Tags are the finer types inside a category tab. They are built by the
 * pipeline (pipeline/load/tagging.py) from OSM cuisine and type, words in the
 * name, and OSM details, and arrive on each business as ";pizza;restaurant;takeout;".
 */

/** Amenities rather than kinds of business; shown in their own section. Keep in sync with FEATURE_RULES in tagging.py. */
export const FEATURE_TAGS = new Set([
  "takeout",
  "delivery",
  "outdoor_seating",
  "drive_through",
  "wheelchair_accessible",
  "wifi",
  "vegan",
  "vegetarian",
  "halal",
  "kosher",
  "gluten_free",
]);

/** Labels that "first letter uppercase" gets wrong */
const LABELS: Record<string, string> = {
  coffee_shop: "Coffee",
  bubble_tea: "Bubble tea",
  wifi: "Wi-Fi",
  drive_through: "Drive-through",
  wheelchair_accessible: "Wheelchair accessible",
  gluten_free: "Gluten-free",
  lashes_brows: "Lashes & brows",
  tyres: "Tires",
  second_hand: "Thrift & resale",
  alcohol: "Beer, wine & liquor",
  doityourself: "Hardware & DIY",
  greengrocer: "Produce",
  latin_american: "Latin American",
  car_repair: "Car repair",
};

export function tagLabel(tag: string): string {
  if (LABELS[tag]) return LABELS[tag];
  const words = tag.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function businessTags(business: Business): string[] {
  return (business.tags ?? "").split(";").filter(Boolean);
}

export function hasTag(business: Business, tag: string): boolean {
  return (business.tags ?? "").includes(`;${tag};`);
}

export interface TagOption {
  id: string;
  label: string;
  count: number;
  feature: boolean;
}

/** Tags used by at least `minCount` businesses in the group, most common first. */
export function tagOptions(collection: BusinessCollection | null, group: GroupId, minCount = 2): TagOption[] {
  const counts = new Map<string, number>();
  for (const { properties } of collection?.features ?? []) {
    if (properties.group !== group) continue;
    for (const tag of businessTags(properties)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, label: tagLabel(id), count, feature: FEATURE_TAGS.has(id) }));
}
