"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { GROUPS } from "@/lib/groups";
import { businessTags } from "@/lib/tags";
import { cellShareInView, coverage, dataZoom, inBounds, type Bounds, type TileIndex, type TileKey } from "@/lib/geo/tiles";
import type { BusinessCollection, BusinessFeature, BusinessTile, GroupId } from "@/types/business";

/*
 * Business tiles for the screen, loaded the way Organic Maps' renderer
 * loads its own (frontend_renderer.cpp ResolveTileKeys): the tiles covering
 * the view at the current zoom are fetched, ones that leave the view are
 * cancelled or dropped, and the previous zoom's tiles stay until every new
 * one has arrived so the map never blinks empty.
 */

export interface ViewState {
  bounds: Bounds;
  zoom: number;
  center: [number, number];
}

export interface Counts {
  total: number;
  groups: Record<GroupId, number>;
  tags: Partial<Record<GroupId, Map<string, number>>>;
}

interface LoadedTile {
  key: TileKey;
  data: BusinessTile;
}

function emptyGroups(): Record<GroupId, number> {
  return Object.fromEntries(GROUPS.map((group) => [group.id, 0])) as Record<GroupId, number>;
}

function prune(loaded: Record<string, LoadedTile>, wanted: TileKey[]): Record<string, LoadedTile> {
  const wantedIds = new Set(wanted.map((key) => key.id));
  const zoom = wanted[0]?.zoom;
  const ready = wanted.every((key) => key.id in loaded);
  return Object.fromEntries(
    Object.entries(loaded).filter(([id, tile]) => wantedIds.has(id) || (!ready && tile.key.zoom !== zoom)),
  );
}

/**
 * Every business in view by group and tag, not just the pins drawn. Zoom-17
 * tiles hold every business and are counted one by one; shallower tiles
 * carry counts per stat cell, added by the share of each cell on screen.
 */
function countInView(tiles: LoadedTile[], index: TileIndex, bounds: Bounds): Counts {
  const groups = emptyGroups();
  const tags: Counts["tags"] = {};
  const add = (group: GroupId, tag: string, amount: number) => {
    const map = (tags[group] ??= new Map());
    map.set(tag, (map.get(tag) ?? 0) + amount);
  };
  for (const { key, data } of tiles) {
    if (key.zoom === index.max_zoom) {
      for (const { properties, geometry } of data.features) {
        if (!inBounds(geometry.coordinates, bounds)) continue;
        groups[properties.group] += 1;
        for (const tag of businessTags(properties)) add(properties.group, tag, 1);
      }
      continue;
    }
    for (const stat of data.stats ?? []) {
      const share = cellShareInView(key, stat.c[0], stat.c[1], index.stat_cells, bounds);
      if (share === 0) continue;
      for (const [group, count] of Object.entries(stat.g)) groups[group as GroupId] += count * share;
      for (const [group, byTag] of Object.entries(stat.t)) {
        for (const [tag, count] of Object.entries(byTag)) add(group as GroupId, tag, count * share);
      }
    }
  }
  for (const group of GROUPS) groups[group.id] = Math.round(groups[group.id]);
  for (const map of Object.values(tags)) for (const [tag, count] of map) map.set(tag, Math.round(count));
  return { total: Object.values(groups).reduce((sum, count) => sum + count, 0), groups, tags };
}

export function useTiles(view: ViewState | null, minMapZoom: number) {
  const [index, setIndex] = useState<TileIndex | null>(null);
  const [fetched, setFetched] = useState<Record<string, LoadedTile>>({});
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(fetched);
  const wantedRef = useRef<TileKey[]>([]);
  const inFlight = useRef(new Map<string, AbortController>());

  useEffect(() => {
    fetch("/data/tiles.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then(setIndex)
      .catch(() => setError("The business list didn't load. Check your connection and reload the page."));
  }, []);

  const active = view !== null && view.zoom >= minMapZoom;
  const tileZoom = index && view ? dataZoom(index, view.zoom) : null;
  const wanted = useMemo(
    () => (index && view && active ? coverage(index, view.bounds, view.zoom) : []),
    [index, view, active],
  );

  useEffect(() => {
    fetchedRef.current = fetched;
  }, [fetched]);

  useEffect(() => {
    wantedRef.current = wanted;
    const wantedIds = new Set(wanted.map((key) => key.id));
    for (const [id, controller] of inFlight.current) {
      if (wantedIds.has(id)) continue;
      controller.abort();
      inFlight.current.delete(id);
    }
    for (const key of wanted) {
      if (inFlight.current.has(key.id) || key.id in fetchedRef.current) continue;
      const controller = new AbortController();
      inFlight.current.set(key.id, controller);
      fetch(`/data/tiles/${key.zoom}/${key.x}_${key.y}.json`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
        .then((data: BusinessTile) => {
          inFlight.current.delete(key.id);
          setError(null);
          setFetched((current) => prune({ ...current, [key.id]: { key, data } }, wantedRef.current));
        })
        .catch(() => {
          inFlight.current.delete(key.id);
          if (controller.signal.aborted) return;
          setError("Some businesses didn't load. Move the map to try again.");
        });
    }
  }, [wanted]);

  const loaded = useMemo(() => prune(fetched, wanted), [fetched, wanted]);

  // A business can sit in an old-zoom tile and a new one while zooming; the current zoom's copy wins
  const businesses = useMemo<BusinessCollection>(() => {
    const tiles = Object.values(loaded).sort(
      (a, b) => Number(b.key.zoom === tileZoom) - Number(a.key.zoom === tileZoom),
    );
    const seen = new Set<string>();
    const features: BusinessFeature[] = [];
    for (const { data } of tiles) {
      for (const feature of data.features) {
        if (seen.has(feature.properties.id)) continue;
        seen.add(feature.properties.id);
        features.push(feature);
      }
    }
    return { type: "FeatureCollection", features };
  }, [loaded, tileZoom]);

  // Count from one zoom: the current one once it has fully arrived, else the one still showing
  const counts = useMemo<Counts | null>(() => {
    if (!index || !view || !active) return null;
    const tiles = Object.values(loaded);
    const ready = wanted.every((key) => key.id in loaded);
    const zoom = ready ? tileZoom : (tiles.find((tile) => tile.key.zoom !== tileZoom)?.key.zoom ?? tileZoom);
    return countInView(
      tiles.filter((tile) => tile.key.zoom === zoom),
      index,
      view.bounds,
    );
  }, [index, view, active, loaded, wanted, tileZoom]);

  return { index, businesses, counts, tileZoom, active, error };
}
