import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { GroupId } from "@/types/business";
import styles from "./CategoryTabs.module.css";

interface Props {
  selected: GroupFilter;
  counts: Record<GroupId, number>;
  onChange: (group: GroupFilter) => void;
}

export default function CategoryTabs({ selected, counts, onChange }: Props) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const tabs: { id: GroupFilter; label: string; color: string; count: number }[] = [
    { id: "all", label: "All", color: "var(--foreground)", count: total },
    ...GROUPS.map((group) => ({ ...group, count: counts[group.id] })),
  ];

  return (
    <div className={styles.tabs} role="tablist" aria-label="Business categories">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={selected === tab.id}
          className={styles.tab}
          onClick={() => onChange(tab.id)}
        >
          <span className={styles.dot} style={{ background: tab.color }} aria-hidden />
          {tab.label}
          <span className={styles.count}>{tab.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
