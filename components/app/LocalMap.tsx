"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";

import DirectionsView from "@/components/sidebar/DirectionsView";
import Filters from "@/components/sidebar/Filters";
import PlaceDetail from "@/components/sidebar/PlaceDetail";
import PlaceList from "@/components/sidebar/PlaceList";
import SavedList from "@/components/sidebar/SavedList";
import SearchField from "@/components/sidebar/SearchField";
import styles from "@/components/sidebar/Sidebar.module.css";
import { useRouteSession } from "@/hooks/useRouteSession";
import { useSaved, type SavedSpot } from "@/hooks/useSaved";
import { useTheme, type ThemeChoice } from "@/hooks/useTheme";
import { useTiles, type ViewState } from "@/hooks/useTiles";
import { inBounds, intersects, type Bounds } from "@/lib/geo/tiles";
import type { GroupFilter } from "@/lib/groups";
import type { SearchEntry } from "@/lib/search";
import { hasTag, tagOptions } from "@/lib/tags";
import type { BusinessCollection, BusinessFeature, GroupId } from "@/types/business";
import type { LngLat } from "@/types/routing";

// MapLibre needs the browser (window, WebGL)
const OrganicMap = dynamic(() => import("@/components/map/OrganicMap"), { ssr: false });

/** Business pins start here (MapLibre zoom; Organic Maps zoom 10, the shallowest tile zoom) */
const PINS_FROM_ZOOM = 9;
/** Rows in the sidebar list; the map shows the rest */
const LIST_LIMIT = 60;
const AREA = "Washington, DC area";
const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "Auto" },
];

/** The town most places near the middle of the view list as theirs */
function townInView(places: BusinessCollection, [west, south, east, north]: Bounds): string | null {
  const width = (east - west) / 3;
  const height = (north - south) / 3;
  const middle: Bounds = [west + width, south + height, east - width, north - height];
  const counts = new Map<string, number>();
  for (const { properties, geometry } of places.features) {
    if (properties.city && inBounds(geometry.coordinates, middle)) {
      counts.set(properties.city, (counts.get(properties.city) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export default function LocalMap() {
  const [view, setView] = useState<ViewState | null>(null);
  const { index, businesses, counts, tileZoom, active, error } = useTiles(view, PINS_FROM_ZOOM);
  const [group, setGroup] = useState<GroupFilter>("all");
  const [groupBeforeSaved, setGroupBeforeSaved] = useState<GroupFilter>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Held apart from the tiles, so the details stay open when the tile is dropped
  const [selected, setSelected] = useState<BusinessFeature | null>(null);
  const [hovered, setHovered] = useState<BusinessFeature | null>(null);
  const [focus, setFocus] = useState<{ position: LngLat; key: number } | null>(null);
  const [fitSavedKey, setFitSavedKey] = useState(0);
  const navigation = useRouteSession();
  const { saved, isSaved, toggle, remove } = useSaved();
  const { choice: themeChoice, theme, choose: chooseTheme } = useTheme();

  // A search or saved pick names a place before its tile arrives; take it once it does
  if (selectedId && selected?.properties.id !== selectedId) {
    const found = businesses.features.find((feature) => feature.properties.id === selectedId);
    if (found) setSelected(found);
  }
  const place = selected?.properties.id === selectedId ? selected : null;

  // The sidebar list: places drawn on screen, in the map's own order
  const inGroup = group !== "all" && group !== "saved";
  const listed = useMemo(() => {
    if (!view || !active || tileZoom === null || group === "saved") return [];
    return businesses.features
      .filter(({ properties, geometry }) => {
        const shownFrom = inGroup ? properties.gz : properties.z;
        return (
          (shownFrom ?? 99) <= tileZoom &&
          (!inGroup || properties.group === group) &&
          (!tag || hasTag(properties, tag)) &&
          inBounds(geometry.coordinates, view.bounds)
        );
      })
      .sort(
        (a, b) =>
          (b.properties.priority ?? 0) - (a.properties.priority ?? 0) ||
          (b.properties.rank ?? 0) - (a.properties.rank ?? 0) ||
          a.properties.name.localeCompare(b.properties.name),
      )
      .slice(0, LIST_LIMIT);
  }, [businesses, view, active, tileZoom, group, inGroup, tag]);

  const tags = useMemo(() => (inGroup ? tagOptions(counts?.tags[group as GroupId] ?? new Map()) : []), [counts, group, inGroup]);
  const outside = active && index !== null && view !== null && !intersects(view.bounds, index.region);
  let inViewTotal: number | null = null;
  if (counts && tag && inGroup) inViewTotal = counts.tags[group as GroupId]?.get(tag) ?? 0;
  else if (counts) inViewTotal = inGroup ? counts.groups[group as GroupId] : counts.total;

  function chooseGroup(next: GroupFilter) {
    let target = next;
    if (next === "saved" && group === "saved") target = groupBeforeSaved;
    else if (next === "saved") {
      setGroupBeforeSaved(group);
      setFitSavedKey(Date.now());
    }
    setGroup(target);
    setTag(null);
  }

  function open(feature: BusinessFeature | null) {
    if (navigation.destination) return; // the map click belongs to directions
    setSelectedId(feature?.properties.id ?? null);
    setSelected(feature);
    setHovered(null);
  }

  function flyTo(id: string, position: LngLat) {
    setSelectedId(id);
    setFocus({ position, key: Date.now() });
  }

  function pickSearch(entry: SearchEntry) {
    if (inGroup && group !== entry.group) setGroup("all");
    setTag(null);
    flyTo(entry.id, [entry.lng, entry.lat]);
  }

  function pickTag(nextTag: string, nextGroup: GroupId) {
    setGroup(nextGroup);
    setTag(nextTag);
  }

  function openSaved(spot: SavedSpot) {
    flyTo(spot.id, [spot.lng, spot.lat]);
  }

  function toggleSaved() {
    if (!place) return;
    const { properties, geometry } = place;
    toggle({
      id: properties.id,
      name: properties.name,
      group: properties.group,
      category: properties.category,
      city: properties.city,
      lng: geometry.coordinates[0],
      lat: geometry.coordinates[1],
    });
  }

  const town = view && active ? townInView(businesses, view.bounds) : null;
  let status: string | null = null;
  if (!active) status = "Zoom in to see local businesses";
  else if (outside) status = "We haven’t mapped businesses here yet. Head back toward DC.";
  else if (error) status = error;

  let body;
  if (navigation.destination) body = <DirectionsView session={navigation} />;
  else if (place) {
    body = (
      <PlaceDetail
        place={place.properties}
        saved={isSaved(place.properties.id)}
        onBack={() => open(null)}
        onToggleSave={toggleSaved}
        onDirections={() =>
          navigation.open({
            id: place.properties.id,
            name: place.properties.name,
            position: place.geometry.coordinates as LngLat,
          })
        }
      />
    );
  } else if (group === "saved") body = <SavedList saved={saved} onOpen={openSaved} onRemove={remove} />;
  else if (!active) body = <p className={styles.empty}>Zoom in on the map to list the businesses there.</p>;
  else {
    body = (
      <PlaceList
        places={listed}
        total={inViewTotal}
        onOpen={(feature) => {
          open(feature);
          setFocus({ position: feature.geometry.coordinates as LngLat, key: Date.now() });
        }}
        onHover={setHovered}
      />
    );
  }

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.appBar}>
          <p className={styles.appName}>Local Map</p>
          <div className={styles.theme} role="radiogroup" aria-label="Map colors">
            {THEME_CHOICES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={themeChoice === option.id}
                className={styles.themeOption}
                title={option.id === "auto" ? "Follow this computer’s light or dark setting" : undefined}
                onClick={() => chooseTheme(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <header className={styles.header}>
          <h1 className={styles.place}>{town ?? AREA}</h1>
          <p className={styles.tagline}>
            {counts && !outside
              ? `${counts.total.toLocaleString()} independent ${counts.total === 1 ? "business" : "businesses"} in view`
              : "Independent businesses, no chains"}
          </p>
        </header>
        <SearchField view={view?.bounds ?? null} onPickPlace={pickSearch} onPickTag={pickTag} />
        {!navigation.destination && !place && (
          <Filters
            group={group}
            counts={counts?.groups ?? null}
            total={counts?.total ?? null}
            savedCount={saved.length}
            tags={tags}
            tag={tag}
            onGroup={chooseGroup}
            onTag={setTag}
          />
        )}
        <div className={styles.body}>{body}</div>
      </aside>
      <main className={styles.mapArea}>
        <OrganicMap
          theme={theme}
          businesses={businesses}
          tileZoom={tileZoom}
          group={group}
          tag={tag}
          saved={saved}
          selected={place}
          hovered={hovered}
          focus={focus}
          fitSavedKey={fitSavedKey}
          onSelect={open}
          onSavedPick={(id) => {
            const spot = saved.find((s) => s.id === id);
            if (spot && !navigation.destination) openSaved(spot);
          }}
          onView={setView}
          routing={{
            line: navigation.route?.coordinates ?? null,
            mode: navigation.mode,
            start: navigation.start?.position ?? null,
            finish: navigation.destination?.position ?? null,
            user: navigation.position,
            picking: navigation.picking,
            following: navigation.live !== null,
            onPick: navigation.setPickedStart,
          }}
        />
        {status && <p className={styles.status}>{status}</p>}
      </main>
    </div>
  );
}
