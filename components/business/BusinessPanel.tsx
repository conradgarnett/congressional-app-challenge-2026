import { GROUPS, categoryLabel } from "@/lib/groups";
import type { Business } from "@/types/business";
import styles from "./BusinessPanel.module.css";

interface Props {
  business: Business;
  onClose: () => void;
  onDirections: () => void;
}

function address(business: Business): string | null {
  const street = [business.housenumber, business.street].filter(Boolean).join(" ");
  const parts = [street, business.city, business.postcode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export default function BusinessPanel({ business, onClose, onDirections }: Props) {
  const group = GROUPS.find((g) => g.id === business.group);
  const where = address(business);
  const osmUrl = `https://www.openstreetmap.org/${business.id}`;

  return (
    <aside className={styles.panel} aria-label={business.name}>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
        ×
      </button>
      {group && (
        <p className={styles.group}>
          <span className={styles.dot} style={{ background: group.color }} aria-hidden />
          {group.label}
        </p>
      )}
      <h2 className={styles.name}>{business.name}</h2>
      <p className={styles.category}>
        {categoryLabel(business.category)}
        {business.cuisine && ` · ${business.cuisine.replace(/[_;]/g, " ")}`}
      </p>

      <button type="button" className={styles.directions} onClick={onDirections}>
        Directions
      </button>

      <dl className={styles.details}>
        {where && (
          <>
            <dt>Address</dt>
            <dd>{where}</dd>
          </>
        )}
        {business.hours && (
          <>
            <dt>Hours</dt>
            <dd>{business.hours}</dd>
          </>
        )}
        {business.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${business.phone}`}>{business.phone}</a>
            </dd>
          </>
        )}
        {business.website && (
          <>
            <dt>Website</dt>
            <dd>
              <a href={websiteHref(business.website)} target="_blank" rel="noopener noreferrer">
                {business.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
              </a>
            </dd>
          </>
        )}
      </dl>

      <p className={styles.source}>
        Source:{" "}
        <a href={osmUrl} target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>
        . Something wrong or missing? Anyone can fix it there.
      </p>
    </aside>
  );
}
