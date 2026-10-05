"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cumulativeDistances, distanceMeters, pointAlong, snapToLine } from "@/lib/routing/geometry";
import { fetchRoute } from "@/lib/routing/valhalla";
import type { Destination, LngLat, Route, TravelMode } from "@/types/routing";

/*
 * Live routing, modeled on Organic Maps' RoutingSession
 * (libs/routing/routing_session.cpp): follow the user's position, work out
 * the next turn, and ask for a new route when they leave the current one.
 */

/** Farther than this from the route line counts as off route */
const OFF_ROUTE_METERS = 40;
/** ...for this many position updates in a row (one bad GPS fix is not enough) */
const OFF_ROUTE_UPDATES = 3;
/** Never re-route more often than this (the routing server is shared) */
const MIN_REROUTE_INTERVAL_MS = 10_000;
/** Within this distance of the destination counts as arrived */
const ARRIVED_METERS = 25;

/** Demo mode moves along the route faster than real life so a trip fits in a video */
const DEMO_SPEED_METERS_PER_SECOND: Record<TravelMode, number> = {
  pedestrian: 8,
  bicycle: 20,
  auto: 40,
};

export type StartSource = "gps" | "map";
export type LiveMode = "gps" | "demo";

export interface Progress {
  /** The next maneuver ahead of the user */
  maneuverIndex: number;
  toNextMeters: number;
  remainingMeters: number;
  arrived: boolean;
}

function locationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "Location permission was denied.";
  if (error.code === error.TIMEOUT) return "Finding your location took too long.";
  return "Your location is unavailable.";
}

export function useRouteSession() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [mode, setMode] = useState<TravelMode>("pedestrian");
  const [start, setStart] = useState<{ position: LngLat; source: StartSource } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<{ key: string; route?: Route; error?: string } | null>(null);
  const [live, setLive] = useState<LiveMode | null>(null);
  const [position, setPosition] = useState<LngLat | null>(null);

  // A route request is identified by its inputs; a result for other inputs is stale
  const key = destination && start ? JSON.stringify([start.position, destination.position, mode]) : null;
  const current = result && result.key === key ? result : null;
  // While re-routing during navigation, keep showing the old route until the new one arrives
  const route = current?.route ?? (live && result?.route ? result.route : null);
  const routeError = current?.error ?? null;
  const loading = key !== null && current === null;

  useEffect(() => {
    if (!key || !destination || !start) return;
    const controller = new AbortController();
    fetchRoute(start.position, destination.position, mode, controller.signal)
      .then((found) => setResult({ key, route: found }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [key, destination, start, mode]);

  const cumulative = useMemo(() => (route ? cumulativeDistances(route.coordinates) : null), [route]);

  const progress = useMemo<Progress | null>(() => {
    if (!route || !cumulative || !position || !destination) return null;
    const snap = snapToLine(position, route.coordinates, cumulative);
    const total = cumulative[cumulative.length - 1];
    const remainingMeters = Math.max(0, total - snap.along);
    // The next maneuver is the first one that starts ahead of the user
    let maneuverIndex = route.maneuvers.findIndex((m) => cumulative[m.beginIndex] > snap.along + 5);
    if (maneuverIndex === -1) maneuverIndex = route.maneuvers.length - 1;
    const toNextMeters = Math.max(0, cumulative[route.maneuvers[maneuverIndex].beginIndex] - snap.along);
    const arrived =
      distanceMeters(position, destination.position) < ARRIVED_METERS || remainingMeters < ARRIVED_METERS;
    return { maneuverIndex, toNextMeters, remainingMeters, arrived };
  }, [route, cumulative, position, destination]);

  // Position updates arrive in callbacks, so they read the route through refs
  const routeRef = useRef<{ route: Route; cumulative: number[] } | null>(null);
  useEffect(() => {
    routeRef.current = route && cumulative ? { route, cumulative } : null;
  }, [route, cumulative]);
  const offRouteCount = useRef(0);
  const lastReroute = useRef(0);

  const handlePosition = useCallback((point: LngLat) => {
    setPosition(point);
    const active = routeRef.current;
    if (!active) return;
    const { offRoute } = snapToLine(point, active.route.coordinates, active.cumulative);
    offRouteCount.current = offRoute > OFF_ROUTE_METERS ? offRouteCount.current + 1 : 0;
    if (offRouteCount.current >= OFF_ROUTE_UPDATES && Date.now() - lastReroute.current > MIN_REROUTE_INTERVAL_MS) {
      offRouteCount.current = 0;
      lastReroute.current = Date.now();
      setStart({ position: point, source: "gps" }); // new start -> new route request
    }
  }, []);

  useEffect(() => {
    if (live !== "gps") return;
    const watchId = navigator.geolocation.watchPosition(
      (fix) => handlePosition([fix.coords.longitude, fix.coords.latitude]),
      (error) => setLocationError(locationErrorMessage(error)),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [live, handlePosition]);

  useEffect(() => {
    if (live !== "demo" || !routeRef.current) return;
    const { route: demoRoute, cumulative: demoCumulative } = routeRef.current;
    const total = demoCumulative[demoCumulative.length - 1];
    let traveled = 0;
    const timer = setInterval(() => {
      traveled = Math.min(total, traveled + DEMO_SPEED_METERS_PER_SECOND[mode]);
      handlePosition(pointAlong(demoRoute.coordinates, demoCumulative, traveled));
      if (traveled >= total) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [live, mode, handlePosition]);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationError("This browser can't share your location.");
      setPicking(true);
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        const point: LngLat = [fix.coords.longitude, fix.coords.latitude];
        setLocating(false);
        setPicking(false);
        setPosition(point);
        setStart({ position: point, source: "gps" });
      },
      (error) => {
        setLocating(false);
        setLocationError(`${locationErrorMessage(error)} Click the map to choose a starting point.`);
        setPicking(true);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }, []);

  const open = useCallback(
    (next: Destination) => {
      setDestination(next);
      setLive(null);
      setResult(null);
      if (start?.source !== "map") locate();
    },
    [start, locate],
  );

  const close = useCallback(() => {
    setDestination(null);
    setStart(null);
    setResult(null);
    setLive(null);
    setPosition(null);
    setPicking(false);
    setLocating(false);
    setLocationError(null);
  }, []);

  const pickStart = useCallback(() => setPicking(true), []);

  const setPickedStart = useCallback((point: LngLat) => {
    setStart({ position: point, source: "map" });
    setPicking(false);
    setLocationError(null);
  }, []);

  const startLive = useCallback((liveMode: LiveMode) => {
    offRouteCount.current = 0;
    lastReroute.current = 0;
    setLive(liveMode);
  }, []);

  const stopLive = useCallback(() => setLive(null), []);

  return {
    destination,
    mode,
    setMode,
    start,
    locating,
    locationError,
    picking,
    route,
    loading,
    routeError,
    live,
    position,
    progress,
    open,
    close,
    locate,
    pickStart,
    setPickedStart,
    startLive,
    stopLive,
  };
}

export type RouteSession = ReturnType<typeof useRouteSession>;
