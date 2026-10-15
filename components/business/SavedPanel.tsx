import { GROUPS, categoryLabel } from "@/lib/groups";
import type { SavedSpot } from "@/hooks/useSaved";
import styles from "./SavedPanel.module.css";

interface Props {
  saved: SavedSpot[];
  onOpen: (spot: SavedSpot) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export default function SavedPanel({ saved, onOpen, onRemove, onClose }: Props) {
  return (
    <aside className={styles.panel} aria-label="Saved spots">
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close saved spots">
        ×
      </button>
      <h2 className={styles.title}>Your saved spots</h2>

      {saved.length === 0 ? (
        <p className={styles.empty}>
          Nothing saved yet. Open any place on the map and press <strong>Save</strong> to keep it here.
        </p>
      ) : (
        <>
          <p className={styles.note}>Saved on this device only.</p>
          <ul className={styles.list}>
            {saved.map((spot) => {
              const group = GROUPS.find((g) => g.id === spot.group);
              return (
                <li key={spot.id} className={styles.item}>
                  <button type="button" className={styles.open} onClick={() => onOpen(spot)}>
                    <span className={styles.dot} style={{ background: group?.color }} aria-hidden />
                    <span>
                      <span className={styles.name}>{spot.name}</span>
                      <span className={styles.meta}>
                        {categoryLabel(spot.category)}
                        {spot.city && `, ${spot.city}`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => onRemove(spot.id)}
                    aria-label={`Remove ${spot.name} from saved`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
