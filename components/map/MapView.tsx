"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import BusinessPanel from "@/components/business/BusinessPanel";
import CategoryTabs from "@/components/business/CategoryTabs";
import SavedPanel from "@/components/business/SavedPanel";
import SearchBox from "@/components/business/SearchBox";
import TagFilter from "@/components/business/TagFilter";
import DirectionsPanel from "@/components/routing/DirectionsPanel";
import { useRouteSession } from "@/hooks/useRouteSession";
import { useSaved, type SavedSpot } from "@/hooks/useSaved";
import {
  cellShareInView,
  coverage,
  dataZoom,
  inBounds,
  intersects,
  type Bounds,
  type TileIndex,
  type TileKey,
} from "@/lib/geo/tiles";
import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { SearchEntry } from "@/lib/search";
import { businessTags, hasTag, tagOptions } from "@/lib/tags";
import type { BusinessCollection, BusinessFeature, BusinessTile, GroupId } from "@/types/business";
import type { MapView as View } from "./BusinessMap";
import styles from "./MapView.module.css";

// MapLibre needs the browser (window, WebGL), so skip server rendering
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false });

/** Keep in sync with PIN_MIN_ZOOM in BusinessMap.tsx (importing it would load MapLibre on the server) */
const PIN_MIN_ZOOM = 9;

/** Header title when the map shows no town name */
const AREA_NAME = "Washington, DC area";

/**
 * The town most businesses near the middle of the screen list as their
 * city, e.g. "Bethesda". Only the middle third counts, so the title follows
 * what you're centered on, not a busy town at the edge.
 */
function mainCity(businesses: BusinessCollection | null, [west, south, east, north]: Bounds): string | null {
  const width = (east - west) / 3;
  const height = (north - south) / 3;
  const middle: Bounds = [west + width, south + height, east - width, north - height];
  const counts = new Map<string, number>();
  for (const { properties, geometry } of businesses?.features ?? []) {
    if (!properties.city || !inBounds(geometry.coordinates, middle)) continue;
    counts.set(properties.city, (counts.get(properties.city) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [city, count] of counts) if (best === null || count > counts.get(best)!) best = city;
  return best;
}

type Counts = { total: number; groups: Record<GroupId, number>; tags: Partial<Record<GroupId, Map<string, number>>> };

/**
 * Businesses in view, by group and by tag. Deepest-zoom tiles hold every
 * business, so those are counted one by one; other tiles carry counts per
 * stat cell (see lib/geo/tiles.ts). Counts every business, not just pins shown.
 */
function countInView(tiles: LoadedTile[], cells: number, maxZoom: number, bounds: Bounds): Counts {
  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<GroupId, number>;
  const tags: Counts["tags"] = {};
  const add = (group: GroupId, tag: string, amount: number) => {
    const map = (tags[group] ??= new Map());
    map.set(tag, (map.get(tag) ?? 0) + amount);
  };
  for (const { key, data } of tiles) {
    if (key.zoom === maxZoom) {
      for (const { properties, geometry } of data.features) {
        if (!inBounds(geometry.coordinates, bounds)) continue;
        groups[properties.group] += 1;
        for (const tag of businessTags(properties)) add(properties.group, tag, 1);
      }
      continue;
    }
    for (const stat of data.stats ?? []) {
      const share = cellShareInView(key, stat.c[0], stat.c[1], cells, bounds);
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

interface LoadedTile {
  key: TileKey;
  data: BusinessTile;
}

/**
 * Like Organic Maps' renderer (frontend_renderer.cpp ResolveTileKeys): tiles
 * of the current zoom that leave the screen go at once; tiles of the zoom
 * before stay until every tile now wanted has arrived, so the map never
 * blinks empty while zooming.
 */
function prune(loaded: Record<string, LoadedTile>, wanted: TileKey[]): Record<string, LoadedTile> {
  const wantedIds = new Set(wanted.map((key) => key.id));
  const zoom = wanted[0]?.zoom;
  const ready = wanted.every((key) => key.id in loaded);
  return Object.fromEntries(
    Object.entries(loaded).filter(([id, tile]) => wantedIds.has(id) || (!ready && tile.key.zoom !== zoom)),
  );
}

export default function MapView() {
  const [tileIndex, setTileIndex] = useState<TileIndex | null>(null);
  // Tiles fetched; pruned to the screen's tiles each time one arrives
  const [fetched, setFetched] = useState<Record<string, LoadedTile>>({});
  const fetchedRef = useRef(fetched);
  const inFlight = useRef(new Map<string, AbortController>());
  const wantedRef = useRef<TileKey[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [group, setGroup] = useState<GroupFilter>("all");
  const [tag, setTag] = useState<string | null>(null);
  // Where to go back to when the Saved tab is turned off
  const [groupBeforeSaved, setGroupBeforeSaved] = useState<GroupFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Kept apart from the tiles, so the panel stays open when its tile is dropped
  const [selectedFeature, setSelectedFeature] = useState<BusinessFeature | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigation = useRouteSession();
  const { saved, isSaved, toggle: toggleSaved, remove: removeSaved } = useSaved();
  const [fitSavedKey, setFitSavedKey] = useState(0);

  useEffect(() => {
    fetch("/data/tiles.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then(setTileIndex)
      .catch(() => setError("The map's business list didn't load. Check your connection and refresh the page."));
  }, []);

  const zoomedIn = view === null || view.zoom >= PIN_MIN_ZOOM;
  const tileZoom = tileIndex && view ? dataZoom(tileIndex, view.zoom) : null;
  const wanted = useMemo(
    () => (tileIndex && view && zoomedIn ? coverage(tileIndex, view.bounds, view.zoom) : []),
    [tileIndex, view, zoomedIn],
  );

  useEffect(() => {
    fetchedRef.current = fetched;
  }, [fetched]);

  // Fetch tiles coming on screen, cancel ones that left before they arrived, drop the rest
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
          setFetched((current) => prune({ ...current, [key.id]: { key, data } }, wantedRef.current));
        })
        .catch((reason) => {
          inFlight.current.delete(key.id);
          if (controller.signal.aborted) return;
          console.warn(`Tile ${key.id} failed`, reason);
          setError("Some businesses didn't load. Check your connection, then move the map to retry.");
        });
    }
  }, [wanted]);

  // Tiles on screen now, plus the previous zoom's until the new ones arrive
  const loaded = useMemo(() => prune(fetched, wanted), [fetched, wanted]);

  // One collection for the map. A business can be in an old-zoom tile and a
  // new one while zooming; the current zoom's copy wins.
  const businesses = useMemo<BusinessCollection>(() => {
    const tiles = Object.values(loaded).sort((a, b) => Number(b.key.zoom === tileZoom) - Number(a.key.zoom === tileZoom));
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

  // Count from one zoom only: the current one once it has fully arrived, else the one still on screen
  const counts = useMemo<Counts | null>(() => {
    if (!tileIndex || !view || !zoomedIn) return null;
    const tiles = Object.values(loaded);
    const ready = wanted.every((key) => key.id in loaded);
    const zoom = ready ? tileZoom : (tiles.find((tile) => tile.key.zoom !== tileZoom)?.key.zoom ?? tileZoom);
    return countInView(
      tiles.filter((tile) => tile.key.zoom === zoom),
      tileIndex.stat_cells,
      tileIndex.max_zoom,
      view.bounds,
    );
  }, [tileIndex, view, zoomedIn, loaded, wanted, tileZoom]);

  // A search or saved pick sets the id before its tile loads; hold on to the business once it does
  if (selectedId && selectedFeature?.properties.id !== selectedId) {
    const found = businesses.features.find((feature) => feature.properties.id === selectedId);
    if (found) setSelectedFeature(found);
  }
  const shownFeature = selectedFeature?.properties.id === selectedId ? selectedFeature : null;
  const selected = shownFeature?.properties ?? null;

  const routing = useMemo(
    () => ({
      route: navigation.route?.coordinates ?? null,
      start: navigation.start?.source === "map" ? navigation.start.position : null,
      user: navigation.position,
      picking: navigation.picking,
      following: navigation.live !== null,
      onPick: navigation.setPickedStart,
    }),
    [navigation.route, navigation.start, navigation.position, navigation.picking, navigation.live, navigation.setPickedStart],
  );

  function openDirections() {
    if (!shownFeature) return;
    navigation.open({
      id: shownFeature.properties.id,
      name: shownFeature.properties.name,
      position: shownFeature.geometry.coordinates as [number, number],
    });
  }

  function selectBusiness(id: string | null) {
    // While directions are open, map clicks don't change the selection
    if (!navigation.destination) setSelectedId(id);
  }

  const tags = useMemo(
    () => (group === "all" || group === "saved" ? [] : tagOptions(counts?.tags[group] ?? new Map())),
    [counts, group],
  );
  const groupCounts = counts?.groups ?? (Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<GroupId, number>);

  function changeGroup(requestedGroup: GroupFilter) {
    // Saved works as a toggle: pressing it again returns to the previous tab
    let next = requestedGroup;
    if (requestedGroup === "saved" && group === "saved") next = groupBeforeSaved;
    else if (requestedGroup === "saved") {
      setGroupBeforeSaved(group);
      setFitSavedKey(Date.now()); // show every saved spot, wherever it is
    }
    setGroup(next);
    setTag(null);
    if (!selected || next === "all") return;
    const stillShown = next === "saved" ? isSaved(selected.id) : selected.group === next;
    if (!stillShown) setSelectedId(null);
  }

  function toggleSelectedSaved() {
    if (!shownFeature) return;
    const { properties, geometry } = shownFeature;
    toggleSaved({
      id: properties.id,
      name: properties.name,
      group: properties.group,
      category: properties.category,
      city: properties.city,
      lng: geometry.coordinates[0],
      lat: geometry.coordinates[1],
    });
  }

  function flyToBusiness(id: string, lng: number, lat: number) {
    setSelectedId(id);
    setFocus({ lng, lat, key: Date.now() });
  }

  function pickSavedOnMap(spotId: string) {
    const spot = saved.find((s) => s.id === spotId);
    if (spot && !navigation.destination) openSaved(spot);
  }

  function openSaved(spot: SavedSpot) {
    flyToBusiness(spot.id, spot.lng, spot.lat);
  }

  function changeTag(next: string | null) {
    setTag(next);
    if (selected && next && !hasTag(selected, next)) setSelectedId(null);
  }

  function showTag(tagId: string, tagGroup: GroupId) {
    setGroup(tagGroup);
    setTag(tagId);
    if (selected && !hasTag(selected, tagId)) setSelectedId(null);
  }

  function pickSearchResult(entry: SearchEntry) {
    if (group !== "all" && (group === "saved" ? !isSaved(entry.id) : group !== entry.group)) setGroup("all");
    setTag(null); // a search pick must not be hidden by a type filter
    flyToBusiness(entry.id, entry.lng, entry.lat);
  }

  const unmapped = zoomedIn && tileIndex !== null && view !== null && !intersects(view.bounds, tileIndex.region);
  let placeLine = "Finding local businesses…";
  if (!zoomedIn) placeLine = "Zoom in to see local businesses";
  else if (unmapped) placeLine = "Not mapped yet";
  else if (counts) {
    placeLine = `${counts.total.toLocaleString()} independent ${counts.total === 1 ? "business" : "businesses"} in view`;
  }

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div className={styles.place}>
          <p className={styles.brand}>Local Map</p>
          <h1 className={styles.placeName}>{(zoomedIn && view && mainCity(businesses, view.bounds)) || AREA_NAME}</h1>
          <p className={styles.placeLine}>{placeLine}</p>
        </div>
        <SearchBox view={view?.bounds ?? null} onPick={pickSearchResult} onPickTag={showTag} />
      </header>

      <CategoryTabs selected={group} counts={groupCounts} savedCount={saved.length} onChange={changeGroup} />
      {group !== "all" && group !== "saved" && (
        <TagFilter
          key={group}
          groupLabel={GROUPS.find((g) => g.id === group)?.label ?? ""}
          options={tags}
          selected={tag}
          onChange={changeTag}
        />
      )}

      <div className={styles.mapArea}>
        <BusinessMap
          businesses={businesses}
          group={group}
          tag={tag}
          saved={saved}
          fitSavedKey={fitSavedKey}
          selected={shownFeature}
          tileZoom={tileZoom}
          focus={focus}
          onSelect={selectBusiness}
          onSavedPick={pickSavedOnMap}
          onViewChange={setView}
          routing={routing}
        />
        {unmapped && group !== "saved" && (
          <p className={styles.status}>We haven&apos;t mapped businesses here yet. Try somewhere closer to DC.</p>
        )}
        {!zoomedIn && group !== "saved" && <p className={styles.status}>Zoom in to see local businesses</p>}
        {error && <p className={styles.status}>{error}</p>}
        {navigation.destination ? (
          <DirectionsPanel session={navigation} />
        ) : selected ? (
          <BusinessPanel
            business={selected}
            saved={isSaved(selected.id)}
            onClose={() => setSelectedId(null)}
            onDirections={openDirections}
            onToggleSave={toggleSelectedSaved}
          />
        ) : (
          group === "saved" && (
            <SavedPanel
              saved={saved}
              onOpen={openSaved}
              onRemove={removeSaved}
              onClose={() => changeGroup("saved")}
            />
          )
        )}
      </div>
    </div>
  );
}
