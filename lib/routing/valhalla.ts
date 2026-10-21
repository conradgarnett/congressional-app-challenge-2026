import type { LngLat, Maneuver, Route, TravelMode } from "@/types/routing";

/**
 * Route requests go to the public Valhalla server run by FOSSGIS (an OSM
 * nonprofit). It is free, needs no key, allows browser requests, and routes
 * on OpenStreetMap roads and paths. Fair use only: fine for the demo, not for
 * heavy traffic. Self-host Valhalla with a DC/MD/VA extract if that changes.
 */
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";

const MILE_IN_METERS = 1609.344;

interface ValhallaManeuver {
  type: number;
  instruction: string;
  verbal_pre_transition_instruction?: string;
  length: number;
  begin_shape_index: number;
}

interface ValhallaResponse {
  trip: {
    status: number;
    summary: { length: number; time: number };
    legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
  };
}

/** Valhalla encodes route shapes as Google polylines with 6 decimal places. */
export function decodePolyline6(encoded: string): LngLat[] {
  const coordinates: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of ["lat", "lng"] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === "lat") lat += delta;
      else lng += delta;
    }
    coordinates.push([lng / 1e6, lat / 1e6]);
  }
  return coordinates;
}

export async function fetchRoute(from: LngLat, to: LngLat, mode: TravelMode, signal?: AbortSignal): Promise<Route> {
  const request = {
    locations: [
      { lon: from[0], lat: from[1] },
      { lon: to[0], lat: to[1] },
    ],
    costing: mode,
    directions_options: { units: "miles" },
  };
  // GET with the request in the query string avoids a CORS preflight request
  const url = `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(request))}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Routing server error (${response.status})`);
  }

  const { trip } = (await response.json()) as ValhallaResponse;
  const coordinates: LngLat[] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of trip.legs) {
    const offset = coordinates.length;
    coordinates.push(...decodePolyline6(leg.shape));
    for (const m of leg.maneuvers) {
      maneuvers.push({
        instruction: m.instruction,
        verbal: m.verbal_pre_transition_instruction,
        lengthMeters: m.length * MILE_IN_METERS,
        beginIndex: offset + m.begin_shape_index,
        type: m.type,
      });
    }
  }

  return {
    coordinates,
    distanceMeters: trip.summary.length * MILE_IN_METERS,
    durationSeconds: trip.summary.time,
    maneuvers,
  };
}
