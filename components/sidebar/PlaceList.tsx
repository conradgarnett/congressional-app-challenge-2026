"use client";

import { categoryLabel } from "@/lib/groups";
import type { BusinessFeature } from "@/types/business";
import styles from "./Sidebar.module.css";

interface Props {
  places: BusinessFeature[];
  total: number | null;
  onOpen: (place: BusinessFeature) => void;
  onHover: (place: BusinessFeature | null) => void;
}

/** The places on screen, in the map's own order (kind of place, then a fixed shuffle). Hovering one raises it on the map. */
export default function PlaceList({ places, total, onOpen, onHover }: Props) {
  if (places.length === 0) {
    return <p className={styles.empty}>Nothing to show here. Zoom out or drag the map to a busier street.</p>;
  }
  return (
    <section className={styles.list} aria-label="Places on the map">
      <p className={styles.listNote}>
        {total !== null && total > places.length
          ? `${places.length} of ${total.toLocaleString()} on the map. Zoom in for more.`
          : `${places.length} on the map`}
      </p>
      <ul onMouseLeave={() => onHover(null)}>
        {places.map((place) => (
          <li key={place.properties.id}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onOpen(place)}
              onMouseEnter={() => onHover(place)}
              onFocus={() => onHover(place)}
            >
              <span className={styles.rowName}>{place.properties.name}</span>
              <span className={styles.rowMeta}>
                {categoryLabel(place.properties.category)}
                {place.properties.city ? `, ${place.properties.city}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
