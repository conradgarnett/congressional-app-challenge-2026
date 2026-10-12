import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { GroupId } from "@/types/business";
import HeartIcon from "./HeartIcon";
import styles from "./CategoryTabs.module.css";

interface Props {
  selected: GroupFilter;
  counts: Record<GroupId, number>;
  savedCount: number;
  onChange: (group: GroupFilter) => void;
}

export default function CategoryTabs({ selected, counts, savedCount, onChange }: Props) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const tabs: { id: GroupFilter; label: string; color: string | null; count: number }[] = [
    { id: "all", label: "Everything", color: null, count: total },
    ...GROUPS.map((group) => ({ ...group, count: counts[group.id] })),
  ];

  return (
    <div className={styles.tabs} role="tablist" aria-label="Kinds of businesses">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={selected === tab.id}
          className={styles.tab}
          onClick={() => onChange(tab.id)}
        >
          {tab.color && <span className={styles.dot} style={{ background: tab.color }} aria-hidden />}
          {tab.label}
          <span className={styles.count}>{tab.count.toLocaleString()}</span>
        </button>
      ))}
      <span className={styles.spacer} aria-hidden />
      <button
        type="button"
        role="tab"
        aria-selected={selected === "saved"}
        className={`${styles.tab} ${styles.saved}`}
        onClick={() => onChange("saved")}
      >
        <HeartIcon filled={savedCount > 0} />
        Saved
        <span className={styles.count}>{savedCount}</span>
      </button>
    </div>
  );
}
