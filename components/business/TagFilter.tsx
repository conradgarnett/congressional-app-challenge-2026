"use client";

import { useState } from "react";

import type { TagOption } from "@/lib/tags";
import styles from "./TagFilter.module.css";

/** Type chips shown before "More" */
const COLLAPSED_COUNT = 12;

interface Props {
  groupLabel: string;
  options: TagOption[];
  selected: string | null;
  onChange: (tag: string | null) => void;
}

export default function TagFilter({ groupLabel, options, selected, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (options.length === 0) return null;

  const types = options.filter((option) => !option.feature);
  const features = options.filter((option) => option.feature);

  let shownTypes = expanded ? types : types.slice(0, COLLAPSED_COUNT);
  // Keep the selected chip visible even when it sits past the cut
  if (selected && !shownTypes.some((option) => option.id === selected)) {
    const chosen = types.find((option) => option.id === selected);
    if (chosen) shownTypes = [...shownTypes, chosen];
  }
  const hidden = types.length - shownTypes.length;

  const chip = (option: TagOption) => (
    <button
      key={option.id}
      type="button"
      className={styles.chip}
      aria-pressed={selected === option.id}
      onClick={() => onChange(selected === option.id ? null : option.id)}
    >
      {option.label}
      <span className={styles.count}>{option.count}</span>
    </button>
  );

  return (
    <div className={styles.row} role="group" aria-label={`Types of ${groupLabel}`}>
      <button type="button" className={styles.chip} aria-pressed={selected === null} onClick={() => onChange(null)}>
        All {groupLabel.toLowerCase()}
      </button>
      {shownTypes.map(chip)}
      {(hidden > 0 || expanded) && (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Fewer" : `More (${hidden})`}
        </button>
      )}
      {features.length > 0 && (
        <>
          <span className={styles.divider} aria-hidden />
          <span className={styles.sectionLabel}>Features</span>
          {features.map(chip)}
        </>
      )}
    </div>
  );
}
