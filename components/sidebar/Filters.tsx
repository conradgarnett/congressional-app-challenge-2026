"use client";

import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { TagOption } from "@/lib/tags";
import type { GroupId } from "@/types/business";
import styles from "./Sidebar.module.css";

interface Props {
  group: GroupFilter;
  counts: Record<GroupId, number> | null;
  total: number | null;
  savedCount: number;
  tags: TagOption[];
  tag: string | null;
  onGroup: (group: GroupFilter) => void;
  onTag: (tag: string | null) => void;
}

/** What to show: every group, one group, or saved places; then a type inside the group. */
export default function Filters({ group, counts, total, savedCount, tags, tag, onGroup, onTag }: Props) {
  const kinds = tags.filter((option) => !option.feature).slice(0, 10);
  const features = tags.filter((option) => option.feature).slice(0, 4);
  const rows: { id: GroupFilter; label: string; count: number | null }[] = [
    { id: "all", label: "Everything", count: total },
    ...GROUPS.map((g) => ({ id: g.id as GroupFilter, label: g.label, count: counts?.[g.id] ?? null })),
    { id: "saved", label: "Saved", count: savedCount },
  ];
  return (
    <div className={styles.filters}>
      <div className={styles.groups} role="radiogroup" aria-label="What to show">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            role="radio"
            aria-checked={group === row.id}
            className={styles.group}
            onClick={() => onGroup(row.id)}
          >
            <span>{row.label}</span>
            {row.count !== null && <span className={styles.count}>{row.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      {group !== "all" && group !== "saved" && kinds.length + features.length > 0 && (
        <div className={styles.chips} aria-label="Narrow by type">
          {[...kinds, ...features].map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={tag === option.id}
              className={option.feature ? `${styles.chip} ${styles.featureChip}` : styles.chip}
              onClick={() => onTag(tag === option.id ? null : option.id)}
            >
              {option.label}
              <span className={styles.count}>{option.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
