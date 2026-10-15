"use client";

import { categoryLabel } from "@/lib/groups";
import { FEATURE_TAGS, businessTags, tagLabel } from "@/lib/tags";
import type { Business } from "@/types/business";
import styles from "./Sidebar.module.css";

interface Props {
  place: Business;
  saved: boolean;
  onBack: () => void;
  onDirections: () => void;
  onToggleSave: () => void;
}

function osmUrl(id: string) {
  return `https://www.openstreetmap.org/${id}`;
}

function cleanUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** Everything the map knows about one business, and what you can do next. */
export default function PlaceDetail({ place, saved, onBack, onDirections, onToggleSave }: Props) {
  const type = place.category.split("=")[1];
  const tags = businessTags(place).filter((tag) => tag !== type);
  const kinds = tags.filter((tag) => !FEATURE_TAGS.has(tag));
  const features = tags.filter((tag) => FEATURE_TAGS.has(tag));
  const address = [[place.housenumber, place.street].filter(Boolean).join(" "), place.city, place.postcode]
    .filter(Boolean)
    .join(", ");

  return (
    <article className={styles.detail}>
      <button type="button" className={styles.back} onClick={onBack}>
        Back to places on the map
      </button>
      <h2 className={styles.detailName}>{place.name}</h2>
      <p className={styles.detailType}>
        {categoryLabel(place.category)}
        {kinds.length > 0 && `, ${kinds.map(tagLabel).join(", ").toLowerCase()}`}
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onDirections}>
          Directions
        </button>
        <button type="button" className={styles.secondary} aria-pressed={saved} onClick={onToggleSave}>
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {features.length > 0 && (
        <ul className={styles.features} aria-label="Features">
          {features.map((tag) => (
            <li key={tag}>{tagLabel(tag)}</li>
          ))}
        </ul>
      )}
      <dl className={styles.facts}>
        <dt>Address</dt>
        <dd>{address || "Not listed on OpenStreetMap"}</dd>
        {place.hours && (
          <>
            <dt>Hours</dt>
            <dd>{place.hours.replace(/;\s*/g, "\n")}</dd>
          </>
        )}
        {place.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${place.phone}`}>{place.phone}</a>
            </dd>
          </>
        )}
        {place.website && (
          <>
            <dt>Website</dt>
            <dd>
              <a href={place.website} target="_blank" rel="noreferrer">
                {cleanUrl(place.website)}
              </a>
            </dd>
          </>
        )}
        {place.menu && (
          <>
            <dt>Menu</dt>
            <dd>
              <a href={place.menu} target="_blank" rel="noreferrer">
                {cleanUrl(place.menu)}
              </a>
            </dd>
          </>
        )}
      </dl>
      <p className={styles.source}>
        Something wrong or missing?{" "}
        <a href={osmUrl(place.id)} target="_blank" rel="noreferrer">
          Fix it on OpenStreetMap
        </a>
        .
      </p>
    </article>
  );
}
