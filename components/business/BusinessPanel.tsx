import { GROUPS, categoryLabel } from "@/lib/groups";
import { FEATURE_TAGS, businessTags, tagLabel } from "@/lib/tags";
import type { Business } from "@/types/business";
import HeartIcon from "./HeartIcon";
import styles from "./BusinessPanel.module.css";

interface Props {
  business: Business;
  saved: boolean;
  onClose: () => void;
  onDirections: () => void;
  onToggleSave: () => void;
}

function address(business: Business): string | null {
  const street = [business.housenumber, business.street].filter(Boolean).join(" ");
  const parts = [street, business.city, business.postcode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

/** "Chinese restaurant", "Pizza and Italian restaurant", "Hairdresser" */
function describe(business: Business): string {
  const type = business.category.split("=")[1];
  const kinds = businessTags(business)
    .filter((tag) => !FEATURE_TAGS.has(tag) && tag !== type)
    .slice(0, 2)
    .map(tagLabel);
  const typeLabel = categoryLabel(business.category);
  if (kinds.length === 0) return typeLabel;
  return `${kinds.join(" and ")} ${typeLabel.toLowerCase()}`;
}

export default function BusinessPanel({ business, saved, onClose, onDirections, onToggleSave }: Props) {
  const group = GROUPS.find((g) => g.id === business.group);
  const where = address(business);
  const osmUrl = `https://www.openstreetmap.org/${business.id}`;
  const features = businessTags(business).filter((tag) => FEATURE_TAGS.has(tag)).map(tagLabel);

  return (
    <aside className={styles.panel} aria-label={business.name}>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className={styles.name}>{business.name}</h2>
      <p className={styles.category}>
        <span className={styles.dot} style={{ background: group?.color }} aria-hidden />
        {describe(business)}
      </p>
      {features.length > 0 && (
        <ul className={styles.features} aria-label="Features">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.directions} onClick={onDirections}>
          Directions
        </button>
        <button type="button" className={styles.save} aria-pressed={saved} onClick={onToggleSave}>
          <HeartIcon filled={saved} />
          {saved ? "Saved" : "Save"}
        </button>
      </div>

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
        {business.menu && (
          <>
            <dt>Menu</dt>
            <dd>
              <a href={websiteHref(business.menu)} target="_blank" rel="noopener noreferrer">
                See the menu
              </a>
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
        Listed on OpenStreetMap. Something out of date?{" "}
        <a href={osmUrl} target="_blank" rel="noopener noreferrer">
          Anyone can fix it there.
        </a>
      </p>
    </aside>
  );
}
