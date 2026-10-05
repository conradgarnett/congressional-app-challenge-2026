export type TravelMode = "pedestrian" | "bicycle" | "auto";

/** [longitude, latitude], the GeoJSON / MapLibre order */
export type LngLat = [number, number];

export interface Maneuver {
  instruction: string;
  /** Short spoken-style version, e.g. "Turn right onto Main Street." */
  verbal?: string;
  lengthMeters: number;
  /** Index into Route.coordinates where this maneuver starts */
  beginIndex: number;
  /** Valhalla maneuver type: 4-6 mean arrival */
  type: number;
}

export interface Route {
  coordinates: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
  maneuvers: Maneuver[];
}

export interface Destination {
  id: string;
  name: string;
  position: LngLat;
}
