"use client";

import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { BusinessCollection, DistrictCollection } from "@/types/business";
import type { LngLat } from "@/types/routing";

// Copied into public/ by scripts/copy-maplibre-worker.mjs
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// OpenFreeMap: free OSM vector tiles, no key. Vector (not image) tiles let us
// hide the base map's own business icons, so chains like Shell or Walmart
// don't show up next to our small-business pins.
const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Landmark icons that stay on the base map. Every other point of interest
// (shops, restaurants, gas stations, banks...) is hidden.
const LANDMARK_CLASSES = [
  "park", "school", "college", "hospital", "place_of_worship", "library",
  "town_hall", "police", "fire_station", "post", "museum", "attraction",
  "zoo", "stadium", "cemetery", "playground", "campsite", "swimming",
  "information", "airport", "bus", "rail",
];

function hideBaseMapBusinesses(_previous: StyleSpecification | undefined, next: StyleSpecification) {
  const onlyLandmarks = ["in", ["get", "class"], ["literal", LANDMARK_CLASSES]];
  return {
    ...next,
    layers: next.layers.map((layer) => {
      if (!("source-layer" in layer) || layer["source-layer"] !== "poi") return layer;
      const filter = (layer.filter ? ["all", layer.filter, onlyLandmarks] : onlyLandmarks) as FilterSpecification;
      return { ...layer, filter };
    }),
  };
}

const EMPTY: BusinessCollection = { type: "FeatureCollection", features: [] };
const EMPTY_FEATURES = { type: "FeatureCollection" as const, features: [] };

const ROUTE_COLOR = "#1a73e8";

// Switching districts flies: zoom out, glide, zoom back in
const DISTRICT_FLIGHT_MS = 2400;
/** How far the flight zooms out; MapLibre's default is 1.42 */
const DISTRICT_FLIGHT_CURVE = 1.6;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** What the map draws for directions; see hooks/useRouteSession.ts */
export interface RoutingLayer {
  route: LngLat[] | null;
  start: LngLat | null;
  user: LngLat | null;
  /** Next map click sets the start point instead of selecting a business */
  picking: boolean;
  /** Live navigation: keep the user's position centered */
  following: boolean;
  onPick: (point: LngLat) => void;
}

const pointFeature = (point: LngLat) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "Point" as const, coordinates: point },
});

// Color each pin by its group: ["match", group, "food", "#d1495b", ..., fallback]
const GROUP_COLOR = [
  "match",
  ["get", "group"],
  ...GROUPS.flatMap((group) => [group.id, group.color]),
  "#555555",
] as unknown as ExpressionSpecification;

interface Props {
  districts: DistrictCollection;
  districtId: string;
  businesses: BusinessCollection | null;
  group: GroupFilter;
  /** A type inside the group, e.g. "pizza"; see lib/tags.ts */
  tag: string | null;
  selectedId: string | null;
  /** Fly here when it changes (a search pick); `key` lets the same spot re-trigger */
  focus: { lng: number; lat: number; key: number } | null;
  onSelect: (businessId: string | null) => void;
  /** Double-clicking a district switches to it */
  onDistrictPick: (districtId: string) => void;
  routing: RoutingLayer;
}

function districtBounds(districts: DistrictCollection, districtId: string) {
  const district = districts.features.find((feature) => feature.properties.id === districtId);
  if (!district) return null;
  const bounds = new LngLatBounds();
  const polygons =
    district.geometry.type === "Polygon" ? [district.geometry.coordinates] : district.geometry.coordinates;
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0]) bounds.extend([lng, lat]);
  }
  return bounds;
}

export default function BusinessMap({
  districts,
  districtId,
  businesses,
  group,
  tag,
  selectedId,
  focus,
  onSelect,
  onDistrictPick,
  routing,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const firstDistrictView = useRef(true);

  // Keep the latest callbacks without re-creating the map
  const onSelectRef = useRef(onSelect);
  const onDistrictPickRef = useRef(onDistrictPick);
  const routingRef = useRef(routing);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onDistrictPickRef.current = onDistrictPick;
    routingRef.current = routing;
  }, [onSelect, onDistrictPick, routing]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      center: [-77.1, 39.05],
      zoom: 10,
      // Double-click picks a district instead; zoom stays on scroll and the +/- buttons
      doubleClickZoom: false,
    });
    instance.setStyle(BASE_STYLE_URL, { transformStyle: hideBaseMapBusinesses });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    instance.on("load", () => {
      instance.addSource("districts", { type: "geojson", data: districts });
      instance.addSource("businesses", { type: "geojson", data: EMPTY });
      instance.addSource("route", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("route-start", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("user", { type: "geojson", data: EMPTY_FEATURES });

      // Invisible fill: lets a double-click anywhere inside a district find it
      instance.addLayer({
        id: "district-area",
        type: "fill",
        source: "districts",
        paint: { "fill-color": "#000000", "fill-opacity": 0 },
      });
      instance.addLayer({
        id: "district-outline",
        type: "line",
        source: "districts",
        paint: { "line-color": "#6b7280", "line-width": 1, "line-dasharray": [2, 2] },
      });
      instance.addLayer({
        id: "district-selected",
        type: "line",
        source: "districts",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#111827", "line-width": 3 },
      });
      // Route under the pins so it never hides a business
      instance.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 12] },
      });
      instance.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8] },
      });
      instance.addLayer({
        id: "businesses",
        type: "circle",
        source: "businesses",
        paint: {
          "circle-color": GROUP_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 12, 5, 15, 7, 17, 9],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 14, 1.5],
        },
      });

      instance.addLayer({
        id: "business-selected",
        type: "circle",
        source: "businesses",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-color": GROUP_COLOR,
          "circle-radius": 11,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 3,
        },
      });

      instance.addLayer({
        id: "route-start",
        type: "circle",
        source: "route-start",
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 7,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 3,
        },
      });
      instance.addLayer({
        id: "user",
        type: "circle",
        source: "user",
        paint: {
          "circle-color": ROUTE_COLOR,
          "circle-radius": 8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      instance.on("click", (event) => {
        if (routingRef.current.picking) {
          routingRef.current.onPick([event.lngLat.lng, event.lngLat.lat]);
          return;
        }
        const hits = instance.queryRenderedFeatures(event.point, { layers: ["businesses"] });
        onSelectRef.current(hits.length > 0 ? (hits[0].properties.id as string) : null);
      });
      instance.on("dblclick", (event) => {
        if (routingRef.current.picking) return;
        const hit = instance.queryRenderedFeatures(event.point, { layers: ["district-area"] })[0];
        if (hit) onDistrictPickRef.current(hit.properties.id as string);
      });
      instance.on("mouseenter", "businesses", () => {
        if (!routingRef.current.picking) instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "businesses", () => {
        instance.getCanvas().style.cursor = routingRef.current.picking ? "crosshair" : "";
      });

      setLoaded(true);
    });

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // The district outlines never change, so the map is built once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded || !map.current) return;
    map.current.setFilter("district-selected", ["==", ["get", "id"], districtId]);
    const bounds = districtBounds(districts, districtId);
    const camera = bounds && map.current.cameraForBounds(bounds, { padding: 40 });
    if (!camera) return;
    if (firstDistrictView.current) {
      // Opening the page: go straight there
      firstDistrictView.current = false;
      map.current.jumpTo(camera);
      return;
    }
    // Not marked essential, so MapLibre skips the animation for people who
    // ask their system for reduced motion
    map.current.flyTo({
      ...camera,
      duration: DISTRICT_FLIGHT_MS,
      curve: DISTRICT_FLIGHT_CURVE,
      easing: easeInOutCubic,
    });
  }, [loaded, districts, districtId]);

  // Declared after the district effect so a search pick's flyTo wins over fitBounds
  useEffect(() => {
    if (!loaded || !map.current || !focus) return;
    map.current.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 16) });
  }, [loaded, focus]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    map.current.setFilter("business-selected", ["==", ["get", "id"], selectedId ?? ""]);
  }, [loaded, selectedId]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource("businesses") as GeoJSONSource).setData(businesses ?? EMPTY);
  }, [loaded, businesses]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const conditions: ExpressionSpecification[] = [];
    if (group !== "all") conditions.push(["==", ["get", "group"], group]);
    // tags look like ";pizza;italian;restaurant;", so ";pizza;" matches whole tags only
    if (tag) conditions.push(["in", `;${tag};`, ["get", "tags"]]);
    map.current.setFilter("businesses", conditions.length === 0 ? null : ["all", ...conditions]);
  }, [loaded, group, tag]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    map.current.getCanvas().style.cursor = routing.picking ? "crosshair" : "";
  }, [loaded, routing.picking]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const line = routing.route;
    (map.current.getSource("route") as GeoJSONSource).setData(
      line
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }
        : EMPTY_FEATURES,
    );
    // Show the whole route when it first appears, but not while navigating
    if (line && !routingRef.current.following) {
      const bounds = new LngLatBounds();
      for (const point of line) bounds.extend(point);
      // Leave room for the directions panel: on the left on wide screens, at the bottom on phones
      const { clientWidth, clientHeight } = map.current.getContainer();
      const padding =
        clientWidth < 640
          ? { top: 40, bottom: Math.round(clientHeight * 0.6), left: 30, right: 30 }
          : { top: 60, bottom: 60, left: 420, right: 60 };
      map.current.fitBounds(bounds, { padding, maxZoom: 17 });
    }
  }, [loaded, routing.route]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const start = routing.start;
    (map.current.getSource("route-start") as GeoJSONSource).setData(start ? pointFeature(start) : EMPTY_FEATURES);
  }, [loaded, routing.start]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const user = routing.user;
    (map.current.getSource("user") as GeoJSONSource).setData(user ? pointFeature(user) : EMPTY_FEATURES);
    if (user && routing.following) {
      map.current.easeTo({ center: user, zoom: Math.max(map.current.getZoom(), 16), duration: 900 });
    }
  }, [loaded, routing.user, routing.following]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} />;
}
