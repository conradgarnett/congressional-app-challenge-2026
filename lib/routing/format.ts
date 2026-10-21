const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/** 40 m -> "150 ft", 2400 m -> "1.5 mi" */
export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) {
    const feet = Math.max(10, Math.round((meters * FEET_PER_METER) / 10) * 10);
    return `${feet} ft`;
  }
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** 4000 s -> "1 hr 7 min" */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
