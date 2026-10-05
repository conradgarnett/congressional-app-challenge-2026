import type { Business, BusinessCollection, GroupId } from "@/types/business";

/*
 * Tags are the finer types inside a category tab: a business's OSM cuisines
 * ("pizza;italian") plus its OSM type ("amenity=restaurant" -> "restaurant").
 * A pizza place is tagged both "pizza" and "restaurant", so it shows under
 * either chip.
 */

const normalizeTag = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

export function businessTags(business: Business): string[] {
  const tags = new Set<string>();
  for (const cuisine of business.cuisine?.split(";") ?? []) {
    if (cuisine.trim()) tags.add(normalizeTag(cuisine));
  }
  const type = business.category.split("=")[1];
  if (type) tags.add(normalizeTag(type));
  return [...tags];
}

/**
 * Adds a `tags` property like ";pizza;italian;restaurant;" to every business,
 * so the map can filter with a plain substring test.
 */
export function withTags(collection: BusinessCollection): BusinessCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, tags: `;${businessTags(feature.properties).join(";")};` },
    })),
  };
}

/** "latin_american" -> "Latin american" */
export function tagLabel(tag: string): string {
  const words = tag.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface TagOption {
  id: string;
  label: string;
  count: number;
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
    .map(([id, count]) => ({ id, label: tagLabel(id), count }));
}

export function hasTag(business: Business, tag: string): boolean {
  return businessTags(business).includes(tag);
}
