import type { DistrictCollection } from "@/types/business";

/** [west, south, east, north] */
export type Bounds = [number, number, number, number];
type Ring = number[][];

function rings(geometry: DistrictCollection["features"][number]["geometry"]): Ring[][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

/** Bounding box of every district, by id */
export function districtBoxes(districts: DistrictCollection): Map<string, Bounds> {
  const boxes = new Map<string, Bounds>();
  for (const feature of districts.features) {
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of rings(feature.geometry)) {
      for (const [lng, lat] of polygon[0]) {
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
      }
    }
    boxes.set(feature.properties.id, [west, south, east, north]);
  }
  return boxes;
}

export function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function inBounds([lng, lat]: number[], bounds: Bounds): boolean {
  return lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

/** Ray casting: is the point inside the ring? */
function inRing([x, y]: number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The district a point falls in, if any */
export function districtAt(point: number[], districts: DistrictCollection, boxes: Map<string, Bounds>): string | null {
  for (const feature of districts.features) {
    const box = boxes.get(feature.properties.id);
    if (!box || !inBounds(point, box)) continue;
    for (const [outer, ...holes] of rings(feature.geometry)) {
      if (inRing(point, outer) && !holes.some((hole) => inRing(point, hole))) return feature.properties.id;
    }
  }
  return null;
}
