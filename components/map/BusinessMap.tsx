"use client";

import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { Business, BusinessCollection, DistrictCollection } from "@/types/business";

// Copied into public/ by scripts/copy-maplibre-worker.mjs
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// OSM's public tile server: fine for the demo, not for heavy traffic (see CLAUDE.md)
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const EMPTY: BusinessCollection = { type: "FeatureCollection", features: [] };

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
  onSelect: (business: Business | null) => void;
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

export default function BusinessMap({ districts, districtId, businesses, group, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Keep the latest callback without re-creating the map
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: BASE_STYLE,
      center: [-77.1, 39.05],
      zoom: 10,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    instance.on("load", () => {
      instance.addSource("districts", { type: "geojson", data: districts });
      instance.addSource("businesses", { type: "geojson", data: EMPTY });

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

      instance.on("click", "businesses", (event) => {
        const feature = event.features?.[0];
        if (feature) onSelectRef.current(feature.properties as Business);
      });
      instance.on("click", (event) => {
        const hits = instance.queryRenderedFeatures(event.point, { layers: ["businesses"] });
        if (hits.length === 0) onSelectRef.current(null);
      });
      instance.on("mouseenter", "businesses", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "businesses", () => {
        instance.getCanvas().style.cursor = "";
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
    if (bounds) map.current.fitBounds(bounds, { padding: 40, duration: 800 });
  }, [loaded, districts, districtId]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource("businesses") as GeoJSONSource).setData(businesses ?? EMPTY);
  }, [loaded, businesses]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    map.current.setFilter("businesses", group === "all" ? null : ["==", ["get", "group"], group]);
  }, [loaded, group]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} />;
}
