import type { LngLat } from "@/types/routing";

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Distance from the start of the line to each of its points, in meters. */
export function cumulativeDistances(line: LngLat[]): number[] {
  const result = [0];
  for (let i = 1; i < line.length; i++) result.push(result[i - 1] + distanceMeters(line[i - 1], line[i]));
  return result;
}

export interface Snap {
  /** Meters from the point to the line */
  offRoute: number;
  /** Meters along the line to the closest point */
  along: number;
  /** Index of the segment the closest point is on (line[segment] -> line[segment + 1]) */
  segment: number;
}

/**
 * Closest point on the line. Over a few kilometers the earth is flat enough
 * to project to meters around the point and do plain 2D geometry.
 */
export function snapToLine(point: LngLat, line: LngLat[], cumulative: number[]): Snap {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(toRadians(point[1]));
  const project = (p: LngLat) => [(p[0] - point[0]) * metersPerDegLng, (p[1] - point[1]) * metersPerDegLat];

  let best: Snap = { offRoute: Infinity, along: 0, segment: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = project(line[i]);
    const [bx, by] = project(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    // Fraction along the segment of the point's projection, clamped to the segment
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < best.offRoute) {
      best = { offRoute: distance, along: cumulative[i] + t * (cumulative[i + 1] - cumulative[i]), segment: i };
    }
  }
  return best;
}

/** The point a given distance along the line. */
export function pointAlong(line: LngLat[], cumulative: number[], meters: number): LngLat {
  if (meters <= 0) return line[0];
  for (let i = 1; i < line.length; i++) {
    if (cumulative[i] >= meters) {
      const span = cumulative[i] - cumulative[i - 1];
      const t = span === 0 ? 0 : (meters - cumulative[i - 1]) / span;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
  }
  return line[line.length - 1];
}
