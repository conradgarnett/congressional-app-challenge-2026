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
import type { BusinessCollection, BusinessFeature } from "@/types/business";
import type { LngLat } from "@/types/routing";
import type { SavedSpot } from "@/hooks/useSaved";

// Copied into public/ by scripts/copy-maplibre-worker.mjs
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// OpenFreeMap: free OSM vector tiles, no key. Vector (not image) tiles let us
// hide the base map's own business icons, so chains like Shell or Walmart
// don't show up next to our small-business pins.
// "Positron": a quiet gray style, so the pins carry the color
const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

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

const EMPTY_FEATURES = { type: "FeatureCollection" as const, features: [] };

const ROUTE_COLOR = "#171717";
const INK = "#171717";
const MARIGOLD = "#f0b33c";
/** Business names appear beside pins from this zoom in, like storefront signs */
const LABEL_MIN_ZOOM = 15;
/** No business pins further out than this; only saved spots */
export const PIN_MIN_ZOOM = 9;
/** Pin image: a dot in the group color with a white edge */
const PIN_DIAMETER = 14;
const PIN_PIXEL_RATIO = 2;

/** Draws one pin image per group, so pins can be symbols that avoid overlapping */
function pinImage(color: string) {
  const size = (PIN_DIAMETER + 4) * PIN_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.arc(size / 2, size / 2, (PIN_DIAMETER / 2) * PIN_PIXEL_RATIO, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 2 * PIN_PIXEL_RATIO;
  context.strokeStyle = "#ffffff";
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

export interface MapView {
  bounds: [number, number, number, number];
  zoom: number;
  center: [number, number];
}

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
  /** Businesses in the tiles on screen (lib/geo/tiles.ts) */
  businesses: BusinessCollection;
  /**
   * Organic Maps zoom of the tiles being drawn. A pin shows once this
   * reaches its `z` (its `gz` inside a category tab), so pins left over from
   * a closer zoom thin out at once when zooming out.
   */
  tileZoom: number | null;
  group: GroupFilter;
  /** A type inside the group, e.g. "pizza"; see lib/tags.ts */
  tag: string | null;
  /** The visitor's saved spots, wherever they are: always shown, ringed in marigold */
  saved: SavedSpot[];
  /** Fit the map to all saved spots when this changes */
  fitSavedKey: number;
  /** The open business; drawn from its own source, so it stays ringed when its tile is dropped */
  selected: BusinessFeature | null;
  /** Fly here when it changes (a search pick); `key` lets the same spot re-trigger */
  focus: { lng: number; lat: number; key: number } | null;
  onSelect: (businessId: string | null) => void;
  /** A saved spot was clicked; its tile may not be loaded */
  onSavedPick: (spotId: string) => void;
  /** After every pan or zoom */
  onViewChange: (view: MapView) => void;
  routing: RoutingLayer;
}

/** Leave room for a floating panel: on the left on wide screens, at the bottom on phones */
function panelPadding(map: MapLibreMap) {
  const { clientWidth, clientHeight } = map.getContainer();
  return clientWidth < 640
    ? { top: 40, bottom: Math.round(clientHeight * 0.6), left: 30, right: 30 }
    : { top: 60, bottom: 60, left: 420, right: 60 };
}

export default function BusinessMap({
  businesses,
  tileZoom,
  group,
  tag,
  saved,
  fitSavedKey,
  selected,
  focus,
  onSelect,
  onSavedPick,
  onViewChange,
  routing,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // Keep the latest callbacks without re-creating the map
  const onSelectRef = useRef(onSelect);
  const onSavedPickRef = useRef(onSavedPick);
  const onViewChangeRef = useRef(onViewChange);
  const routingRef = useRef(routing);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onSavedPickRef.current = onSavedPick;
    onViewChangeRef.current = onViewChange;
    routingRef.current = routing;
  }, [onSelect, onSavedPick, onViewChange, routing]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      // Opens on Bethesda and Rockville, Maryland
      center: [-77.12, 39.04],
      zoom: 11,
    });
    instance.setStyle(BASE_STYLE_URL, { transformStyle: hideBaseMapBusinesses });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    instance.on("load", () => {
      for (const group of GROUPS) {
        instance.addImage(`pin-${group.id}`, pinImage(group.color), { pixelRatio: PIN_PIXEL_RATIO });
      }
      instance.addSource("businesses", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("saved", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("selected", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("route", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("route-start", { type: "geojson", data: EMPTY_FEATURES });
      instance.addSource("user", { type: "geojson", data: EMPTY_FEATURES });

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
      // Pins are symbols, so ones that would overlap are hidden, like Organic
      // Maps' overlay tree. The tiles already hold only the pins meant for
      // their zoom (export_site_data.py); padding clears what still collides.
      // When pins compete for space, the business with more information wins
      // (`rank`, set by the pipeline).
      instance.addLayer({
        id: "businesses",
        type: "symbol",
        source: "businesses",
        minzoom: PIN_MIN_ZOOM,
        layout: {
          "icon-image": ["concat", "pin-", ["get", "group"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 13, 1, 17, 1.2],
          "icon-padding": ["interpolate", ["linear"], ["zoom"], 9, 24, 11, 12, 13, 5, 15, 2],
          "icon-allow-overlap": false,
          "symbol-sort-key": ["-", 0, ["coalesce", ["get", "rank"], 0]],
          "text-field": ["step", ["zoom"], "", LABEL_MIN_ZOOM, ["get", "name"]],
          "text-font": ["Noto Sans Regular"], // a font the base map's glyph server has
          "text-size": 12,
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "text-max-width": 9,
          "text-optional": true,
        },
        paint: { "text-color": INK, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });

      // Saved spots come from the saved list, not the tiles, so they show
      // wherever they are, loaded or not
      instance.addLayer({
        id: "saved-pins",
        type: "circle",
        source: "saved",
        paint: {
          "circle-color": GROUP_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 12, 5.5, 15, 7, 17, 9],
          "circle-stroke-color": MARIGOLD,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 15, 3.5],
        },
      });
      instance.addLayer({
        id: "saved-labels",
        type: "symbol",
        source: "saved",
        minzoom: LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "text-max-width": 9,
          "text-optional": true,
        },
        paint: { "text-color": INK, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      instance.addLayer({
        id: "business-selected",
        type: "circle",
        source: "selected",
        paint: {
          "circle-color": GROUP_COLOR,
          "circle-radius": 11,
          "circle-stroke-color": INK,
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
          "circle-stroke-color": INK,
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
        const hits = instance.queryRenderedFeatures(event.point, { layers: ["businesses", "saved-pins"] });
        const business = hits.find((hit) => hit.layer.id === "businesses");
        const savedSpot = hits.find((hit) => hit.layer.id === "saved-pins");
        if (business) onSelectRef.current(business.properties.id as string);
        else if (savedSpot) onSavedPickRef.current(savedSpot.properties.id as string);
        else onSelectRef.current(null);
      });
      for (const layer of ["businesses", "saved-pins"]) {
        instance.on("mouseenter", layer, () => {
          if (!routingRef.current.picking) instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", layer, () => {
          instance.getCanvas().style.cursor = routingRef.current.picking ? "crosshair" : "";
        });
      }

      const reportView = () => {
        const bounds = instance.getBounds();
        const center = instance.getCenter();
        onViewChangeRef.current({
          bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          zoom: instance.getZoom(),
          center: [center.lng, center.lat],
        });
      };
      instance.on("moveend", reportView);
      reportView();

      setLoaded(true);
    });

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

    useEffect(() => {
    if (!loaded || !map.current || !focus) return;
    map.current.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 16) });
  }, [loaded, focus]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource("selected") as GeoJSONSource).setData(selected ?? EMPTY_FEATURES);
  }, [loaded, selected]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource("businesses") as GeoJSONSource).setData(businesses);
  }, [loaded, businesses]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const conditions: ExpressionSpecification[] = [];
    const inGroup = group !== "all" && group !== "saved";
    if (inGroup) conditions.push(["==", ["get", "group"], group]);
    if (tileZoom !== null) conditions.push(["<=", ["get", inGroup ? "gz" : "z"], tileZoom]);
    // tags look like ";pizza;italian;restaurant;", so ";pizza;" matches whole tags only
    if (tag) conditions.push(["in", `;${tag};`, ["get", "tags"]]);
    const filter = conditions.length === 0 ? null : (["all", ...conditions] as ExpressionSpecification);
    map.current.setFilter("businesses", filter);
    // The Saved tab shows only saved spots
    map.current.setLayoutProperty("businesses", "visibility", group === "saved" ? "none" : "visible");
  }, [loaded, group, tag, tileZoom]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource("saved") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: saved.map((spot) => ({
        type: "Feature",
        properties: { id: spot.id, name: spot.name, group: spot.group },
        geometry: { type: "Point", coordinates: [spot.lng, spot.lat] },
      })),
    });
  }, [loaded, saved]);

  useEffect(() => {
    if (!loaded || !map.current || fitSavedKey === 0 || savedRef.current.length === 0) return;
    const bounds = new LngLatBounds();
    for (const spot of savedRef.current) bounds.extend([spot.lng, spot.lat]);
    map.current.fitBounds(bounds, { padding: panelPadding(map.current), maxZoom: 15, duration: 1200 });
  }, [loaded, fitSavedKey]);

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
      map.current.fitBounds(bounds, { padding: panelPadding(map.current), maxZoom: 17 });
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
