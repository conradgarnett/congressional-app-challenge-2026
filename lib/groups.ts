import type { GroupId } from "@/types/business";

export interface Group {
  id: GroupId;
  label: string;
  color: string;
}

/** The map's category tabs. Groups are assigned in pipeline/filter/groups/assign_groups.py. */
export const GROUPS: Group[] = [
  { id: "food", label: "Food & drink", color: "#d64933" },
  { id: "groceries", label: "Groceries & essentials", color: "#3e8e41" },
  { id: "personal_care", label: "Personal care", color: "#8e4fa0" },
  { id: "services", label: "Services", color: "#2d6ca8" },
  { id: "shopping", label: "Shopping", color: "#c9861a" },
];

/** "saved" is the tab for the visitor's saved spots */
export type GroupFilter = GroupId | "all" | "saved";

/** OSM type names that read oddly as-is */
const TYPE_LABELS: Record<string, string> = {
  general: "General store",
  convenience: "Convenience store",
  alcohol: "Beer, wine and liquor",
  doityourself: "Hardware store",
  fast_food: "Fast food",
  car_repair: "Car repair",
  tyres: "Tire shop",
  second_hand: "Thrift store",
  variety_store: "Variety store",
  e_cigarette: "Vape shop",
  funeral_directors: "Funeral home",
};

/** "shop=dry_cleaning" -> "Dry cleaning", "shop=general" -> "General store" */
export function categoryLabel(category: string): string {
  const value = category.split("=")[1] ?? category;
  if (TYPE_LABELS[value]) return TYPE_LABELS[value];
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
