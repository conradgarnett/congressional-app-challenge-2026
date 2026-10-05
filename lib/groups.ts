import type { GroupId } from "@/types/business";

export interface Group {
  id: GroupId;
  label: string;
  color: string;
}

/** The map's category tabs. Groups are assigned in pipeline/filter/groups/assign_groups.py. */
export const GROUPS: Group[] = [
  { id: "food", label: "Food & drink", color: "#d1495b" },
  { id: "groceries", label: "Groceries & essentials", color: "#2a9d5c" },
  { id: "personal_care", label: "Personal care", color: "#8e5bd6" },
  { id: "services", label: "Services", color: "#1f6fb4" },
  { id: "shopping", label: "Shopping", color: "#e08e0b" },
];

export type GroupFilter = GroupId | "all";

/** "shop=dry_cleaning" -> "Dry cleaning" */
export function categoryLabel(category: string): string {
  const value = category.split("=")[1] ?? category;
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
