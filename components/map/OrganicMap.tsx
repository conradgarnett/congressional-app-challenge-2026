"use client";

import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Theme } from "@/hooks/useTheme";
import type { ViewState } from "@/hooks/useTiles";
import type { SavedSpot } from "@/hooks/useSaved";
import type { GroupFilter } from "@/lib/groups";
import type { BusinessCollection, BusinessFeature } from "@/types/business";
import type { LngLat, TravelMode } from "@/types/routing";

/*
 * The map, drawn with Organic Maps' rules. The base map style is generated
 * from their drawing rules (pipeline/style/build_style.py → public/map/).
 * Business pins use their icon for each type and their overlay order:
 * drules priority first, then a fixed random rank per business, so having
 * no website never costs a shop its place on the map. Pins that would collide
 * are hidden, best first, like their overlay tree. Colors below are their
 * named colors from the same drules file.
 */

// Copied into public/ by scripts/copy-maplibre-worker.mjs
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const OM = {
  route: { auto: "#0087ff", pedestrian: "rgba(29,51,158,0.8)", bicycle: "rgba(156,39,176,0.8)" } as Record<TravelMode, string>,
  routeOutline: "#055fcd",
  bookmark: "#e51b23",
};

/**
 * Per theme: Organic Maps' style and caption color for that palette, and the
 * disc each business icon sits on. Their icons are drawn bare on their own
 * map; ours sit on a disc so a tan cafe icon still reads on tan land.
 */
const THEMES = {
  light: {
    style: "/map/style.json",
    caption: "#444444",
    halo: "rgba(255,255,255,0.9)",
    disc: "#ffffff",
    ring: "rgba(34,49,58,0.4)",
    label: "#22313a",
    labelHalo: "#ffffff",
  },
  dark: {
    style: "/map/style-dark.json",
    caption: "#a6a6a6",
    halo: "rgba(15,15,15,0.9)",
    disc: "#262c2f",
    ring: "rgba(255,255,255,0.35)",
    label: "#e6eaec",
    labelHalo: "#0f0f0f",
  },
} satisfies Record<Theme, object>;

/** Disc around a business icon, in CSS pixels */
const DISC_PADDING = 3;
const DISC_RING = 1;

/**
 * "pin:bakery-m": Organic Maps' bakery icon on a disc. Made when the map
 * first needs it (the missing-image resolver), from the icon in the sprite.
 */
function addPinImage(map: MapLibreMap, id: string, theme: Theme) {
  const base = map.getImage(id.slice("pin:".length));
  if (!base) return;
  const { width, height, data } = base.data;
  const ratio = base.pixelRatio;
  const padding = DISC_PADDING * ratio;
  const size = Math.ceil(Math.max(width, height) + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  // Read back with getImageData: keep the canvas on the CPU
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const colors = THEMES[theme];
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - DISC_RING * ratio, 0, Math.PI * 2);
  context.fillStyle = colors.disc;
  context.fill();
  context.lineWidth = DISC_RING * ratio;
  context.strokeStyle = colors.ring;
  context.stroke();
  const icon = document.createElement("canvas");
  icon.width = width;
  icon.height = height;
  icon.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(data), width, height), 0, 0);
  context.drawImage(icon, (size - width) / 2, (size - height) / 2);
  map.addImage(id, context.getImageData(0, 0, size, size), { pixelRatio: ratio });
}

/** Business names show beside pins from this MapLibre zoom (Organic Maps zoom 16, as in their rules) */
export const NAMES_FROM_ZOOM = 15;
const EMPTY = { type: "FeatureCollection" as const, features: [] };

const point = (position: LngLat, properties: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  properties,
  geometry: { type: "Point" as const, coordinates: position },
});

/** Organic Maps marks a search result with a pin that carries the type icon */
function highlightIcon(map: MapLibreMap, feature: BusinessFeature): string {
  const value = feature.properties.category.split("=")[1] ?? "";
  const icon = (feature.properties.icon ?? "").replace(/-(m|s|l|xs)$/, "");
  for (const name of [`search-result-${icon}`, `search-result-shop-${value}`, `search-result-${value}`]) {
    if (map.hasImage(name)) return name;
  }
  return feature.properties.group === "food" ? "search-result-restaurant" : "search-result-shop";
}

/** Organic Maps' bookmark glyphs, by what the saved place is */
function bookmarkIcon(spot: SavedSpot): string {
  const value = spot.category.split("=")[1] ?? "";
  const byType: Record<string, string> = {
    cafe: "bookmark-cafe-m",
    coffee: "bookmark-cafe-m",
    restaurant: "bookmark-restaurant-m",
    fast_food: "bookmark-fast_food-m",
    bar: "bookmark-bar-m",
    pub: "bookmark-pub-m",
    pharmacy: "bookmark-pharmacy-m",
    art: "bookmark-art-m",
    pet: "bookmark-animals-m",
  };
  return byType[value] ?? (spot.group === "food" ? "bookmark-restaurant-m" : "bookmark-shop-m");
}

export interface MapRouting {
  line: LngLat[] | null;
  mode: TravelMode;
  start: LngLat | null;
  finish: LngLat | null;
  user: LngLat | null;
  picking: boolean;
  following: boolean;
  onPick: (point: LngLat) => void;
}

interface Props {
  /** Organic Maps' light or dark palette */
  theme: Theme;
  businesses: BusinessCollection;
  /** Organic Maps zoom of the tiles drawn; a pin shows once this reaches its z (gz in a group) */
  tileZoom: number | null;
  group: GroupFilter;
  tag: string | null;
  saved: SavedSpot[];
  selected: BusinessFeature | null;
  /** The list row under the mouse, raised on the map */
  hovered: BusinessFeature | null;
  /** Fly here when `key` changes */
  focus: { position: LngLat; key: number } | null;
  /** Fit every saved spot when this changes (0 = never) */
  fitSavedKey: number;
  routing: MapRouting;
  onSelect: (feature: BusinessFeature | null) => void;
  onSavedPick: (id: string) => void;
  onView: (view: ViewState) => void;
}

export default function OrganicMap(props: Props) {
  const { theme, businesses, tileZoom, group, tag, saved, selected, hovered, focus, fitSavedKey, routing } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Theme whose style is loaded and has our layers; the map is ready when it matches
  const [installed, setInstalled] = useState<Theme | null>(null);
  const ready = installed === theme;
  const themeRef = useRef(theme);
  const callbacks = useRef(props);
  const savedRef = useRef(saved);
  useEffect(() => {
    callbacks.current = props;
    savedRef.current = saved;
    themeRef.current = theme;
  });

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      center: [-77.1, 39.02], // Bethesda and Rockville
      zoom: 12.5,
      minZoom: 8,
      maxZoom: 19,
      attributionControl: { compact: false },
    });
    // Pins are made on first use. The sprite can still be loading then, so wait for the icon.
    map.setMissingStyleImageResolver(async (id) => {
      if (!id.startsWith("pin:")) return;
      const base = id.slice("pin:".length);
      for (let tries = 0; tries < 100 && !map.hasImage(base); tries++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!map.hasImage(id)) addPinImage(map, id, themeRef.current);
    });

    // Every style load (first, and each theme switch) wipes our sources and layers: add them again
    map.on("style.load", () => {
      const colors = THEMES[themeRef.current];
      for (const id of ["route", "route-points", "saved", "places", "highlight", "user"]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      map.addLayer({
        id: "route-outline",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": OM.routeOutline, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 17, 14] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], OM.route.auto],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 17, 10],
        },
      });
      map.addLayer({
        id: "places",
        type: "symbol",
        source: "places",
        layout: {
          "icon-image": ["concat", "pin:", ["get", "icon"]],
          "icon-padding": 1,
          "icon-allow-overlap": false,
          // Organic Maps' overlay order: priority, then rank (CalculateOverlayPriority); rank is 0-255
          "symbol-sort-key": ["-", 0, ["+", ["*", ["get", "priority"], 256], ["get", "rank"]]],
          "text-field": ["step", ["zoom"], "", NAMES_FROM_ZOOM, ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 0.9],
          "text-max-width": 8,
          "text-optional": true,
        },
        paint: {
          "text-color": colors.caption,
          "text-halo-color": colors.halo,
          "text-halo-width": 1.2,
        },
      });
      map.addLayer({
        id: "saved-bg",
        type: "circle",
        source: "saved",
        paint: {
          "circle-color": OM.bookmark,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 16, 11],
          "circle-stroke-color": colors.disc,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "saved",
        type: "symbol",
        source: "saved",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 16, 0.8],
          "icon-allow-overlap": true,
          "text-field": ["step", ["zoom"], "", NAMES_FROM_ZOOM, ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 1.2],
          "text-optional": true,
        },
        paint: { "text-color": colors.caption, "text-halo-color": colors.halo, "text-halo-width": 1.2 },
      });
      map.addLayer({
        id: "route-points",
        type: "symbol",
        source: "route-points",
        layout: { "icon-image": ["get", "icon"], "icon-anchor": "bottom", "icon-allow-overlap": true },
      });
      map.addLayer({
        id: "highlight",
        type: "symbol",
        source: "highlight",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": [0, 0.3],
          "text-allow-overlap": true,
        },
        paint: { "text-color": colors.label, "text-halo-color": colors.labelHalo, "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "user",
        type: "symbol",
        source: "user",
        layout: { "icon-image": "current-position", "icon-allow-overlap": true },
      });
      setInstalled(themeRef.current);
    });

    map.on("click", (event) => {
      const { routing: route, onSelect, onSavedPick } = callbacks.current;
      if (route.picking) {
        route.onPick([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      const [hit] = map.queryRenderedFeatures(event.point, { layers: ["saved", "places"] });
      if (hit?.layer.id === "saved") onSavedPick(hit.properties.id as string);
      else if (hit) {
        const feature = callbacks.current.businesses.features.find((f) => f.properties.id === hit.properties.id);
        onSelect(feature ?? null);
      } else onSelect(null);
    });
    for (const layer of ["places", "saved"]) {
      map.on("mouseenter", layer, () => {
        if (!callbacks.current.routing.picking) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = callbacks.current.routing.picking ? "crosshair" : "";
      });
    }

    const report = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      callbacks.current.onView({
        bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom: map.getZoom(),
        center: [center.lng, center.lat],
      });
    };
    map.on("moveend", report);
    map.once("load", report);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Organic Maps' light or dark style; the sprite path must become an absolute URL for MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    fetch(THEMES[theme].style)
      .then((response) => response.json())
      .then((style: StyleSpecification) => {
        if (!cancelled) map.setStyle({ ...style, sprite: `${window.location.origin}${style.sprite as string}` }, { diff: false });
      });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current!.getSource("places") as GeoJSONSource).setData(businesses);
  }, [ready, businesses]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const inGroup = group !== "all" && group !== "saved";
    const conditions: ExpressionSpecification[] = [];
    if (inGroup) conditions.push(["==", ["get", "group"], group]);
    // tags look like ";pizza;italian;", so ";pizza;" matches whole tags only
    if (tag) conditions.push(["in", `;${tag};`, ["get", "tags"]]);
    if (tileZoom !== null) conditions.push(["<=", ["get", inGroup ? "gz" : "z"], tileZoom]);
    map.setFilter("places", conditions.length ? (["all", ...conditions] as ExpressionSpecification) : null);
    map.setLayoutProperty("places", "visibility", group === "saved" ? "none" : "visible");
  }, [ready, group, tag, tileZoom]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const shown = [selected, hovered && hovered.properties.id !== selected?.properties.id ? hovered : null].filter(
      (feature): feature is BusinessFeature => feature !== null,
    );
    (map.getSource("highlight") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: shown.map((feature) =>
        point(feature.geometry.coordinates as LngLat, { icon: highlightIcon(map, feature), name: feature.properties.name }),
      ),
    });
  }, [ready, selected, hovered]);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current!.getSource("saved") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: saved.map((spot) => point([spot.lng, spot.lat], { id: spot.id, name: spot.name, icon: bookmarkIcon(spot) })),
    });
  }, [ready, saved]);

  useEffect(() => {
    if (!ready || !focus) return;
    const map = mapRef.current!;
    map.flyTo({ center: focus.position, zoom: Math.max(map.getZoom(), 16.5), padding: { left: 0, right: 0, top: 0, bottom: 0 } });
  }, [ready, focus]);

  useEffect(() => {
    if (!ready || fitSavedKey === 0 || savedRef.current.length === 0) return;
    const bounds = new LngLatBounds();
    for (const spot of savedRef.current) bounds.extend([spot.lng, spot.lat]);
    mapRef.current!.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
  }, [ready, fitSavedKey]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    map.getCanvas().style.cursor = routing.picking ? "crosshair" : "";
    (map.getSource("route") as GeoJSONSource).setData(
      routing.line
        ? {
            type: "Feature",
            properties: { color: OM.route[routing.mode] },
            geometry: { type: "LineString", coordinates: routing.line },
          }
        : EMPTY,
    );
    (map.getSource("route-points") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        ...(routing.start ? [point(routing.start, { icon: "route-point-start" })] : []),
        ...(routing.finish && routing.line ? [point(routing.finish, { icon: "route-point-finish" })] : []),
      ],
    });
    (map.getSource("user") as GeoJSONSource).setData(routing.user ? point(routing.user) : EMPTY);
  }, [ready, routing.line, routing.mode, routing.start, routing.finish, routing.user, routing.picking]);

  // Show a new route whole, but not while navigating
  useEffect(() => {
    if (!ready || !routing.line || routing.following) return;
    const bounds = new LngLatBounds();
    for (const position of routing.line) bounds.extend(position);
    mapRef.current!.fitBounds(bounds, { padding: 80, maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only for a new line
  }, [ready, routing.line]);

  useEffect(() => {
    if (!ready || !routing.user || !routing.following) return;
    mapRef.current!.easeTo({ center: routing.user, zoom: Math.max(mapRef.current!.getZoom(), 16), duration: 800 });
  }, [ready, routing.user, routing.following]);

  // Inline, because maplibre-gl.css sets the container to position: relative
  return <div ref={container} className="map-canvas" style={{ position: "absolute", inset: 0 }} />;
}
