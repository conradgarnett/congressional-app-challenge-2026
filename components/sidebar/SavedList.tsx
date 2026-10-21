"use client";

import type { SavedSpot } from "@/hooks/useSaved";
import { categoryLabel } from "@/lib/groups";
import styles from "./Sidebar.module.css";

interface Props {
  saved: SavedSpot[];
  onOpen: (spot: SavedSpot) => void;
  onRemove: (id: string) => void;
}

/** Places saved in this browser. No account: they stay on this computer. */
export default function SavedList({ saved, onOpen, onRemove }: Props) {
  if (saved.length === 0) {
    return (
      <p className={styles.empty}>
        Nothing saved yet. Open a place and press Save to keep it here. Saved places stay in this browser.
      </p>
    );
  }
  return (
    <section className={styles.list} aria-label="Saved places">
      <p className={styles.listNote}>Saved in this browser</p>
      <ul>
        {saved.map((spot) => (
          <li key={spot.id} className={styles.savedRow}>
            <button type="button" className={styles.row} onClick={() => onOpen(spot)}>
              <span className={styles.rowName}>{spot.name}</span>
              <span className={styles.rowMeta}>
                {categoryLabel(spot.category)}
                {spot.city ? `, ${spot.city}` : ""}
              </span>
            </button>
            <button type="button" className={styles.remove} onClick={() => onRemove(spot.id)} aria-label={`Remove ${spot.name}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
