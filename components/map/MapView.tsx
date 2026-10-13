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
import { boxesOverlap, districtAt, districtBoxes, inBounds } from "@/lib/geo/districts";
import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { SearchEntry } from "@/lib/search";
import { FEATURE_TAGS, businessTags, hasTag, tagOptions } from "@/lib/tags";
import type { Business, BusinessCollection, DistrictCollection, GroupId } from "@/types/business";
import type { MapView as View } from "./BusinessMap";
import styles from "./MapView.module.css";

// MapLibre needs the browser (window, WebGL), so skip server rendering
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false });

const DEMO_DISTRICT = "MD-08";
/** Keep in sync with PIN_MIN_ZOOM in BusinessMap.tsx (importing it would load MapLibre on the server) */
const PIN_MIN_ZOOM = 9;

const STATE_NAMES: Record<string, string> = { MD: "Maryland", VA: "Virginia" };

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "MD-08" -> "Maryland's 8th District", "DC-AL" -> "Washington, DC" */
function districtTitle(id: string): string {
  const [state, number] = id.split("-");
  if (state === "DC") return "Washington, DC";
  return `${STATE_NAMES[state] ?? state}'s ${ordinal(Number(number))} District`;
}

/**
 * How much the map knows about a business. When pins would overlap, the
 * higher rank keeps its spot, so zoomed out you see the best-described places.
 */
function rank(business: Business): number {
  const type = business.category.split("=")[1];
  const kinds = businessTags(business).filter((tag) => tag !== type && !FEATURE_TAGS.has(tag)).length;
  return kinds + (business.website ? 2 : 0) + (business.hours ? 1 : 0) + (business.phone ? 1 : 0) + (business.menu ? 1 : 0);
}

export default function MapView() {
  const [districts, setDistricts] = useState<DistrictCollection | null>(null);
  // Business files load per district, for whichever districts are on screen
  const [byDistrict, setByDistrict] = useState<Record<string, BusinessCollection>>({});
  const requested = useRef(new Set<string>());
  const [view, setView] = useState<View | null>(null);
  const [flyToDistrict, setFlyToDistrict] = useState({ id: DEMO_DISTRICT, key: 0 });
  // The district the map is centered on; MD-08 until the map reports in
  const [lastDistrict, setLastDistrict] = useState(DEMO_DISTRICT);
  const [group, setGroup] = useState<GroupFilter>("all");
  const [tag, setTag] = useState<string | null>(null);
  // Where to go back to when the Saved tab is turned off
  const [groupBeforeSaved, setGroupBeforeSaved] = useState<GroupFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigation = useRouteSession();
  const { saved, isSaved, toggle: toggleSaved, remove: removeSaved } = useSaved();
  const [fitSavedKey, setFitSavedKey] = useState(0);

  useEffect(() => {
    fetch("/data/districts.geojson")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then(setDistricts)
      .catch(() => setError("The district map didn't load. Check your connection and refresh the page."));
  }, []);

  const boxes = useMemo(() => (districts ? districtBoxes(districts) : new Map()), [districts]);

  const centerDistrict = (view && districts && districtAt(view.center, districts, boxes)) ?? lastDistrict;
  const centerInfo = districts?.features.find((feature) => feature.properties.id === centerDistrict)?.properties;
  const zoomedIn = view === null || view.zoom >= PIN_MIN_ZOOM;

  function handleViewChange(next: View) {
    setView(next);
    if (districts) {
      const here = districtAt(next.center, districts, boxes);
      if (here) setLastDistrict(here);
    }
  }

  // Load the business file of every district on screen that has one
  useEffect(() => {
    if (!districts || !view || view.zoom < PIN_MIN_ZOOM) return;
    for (const feature of districts.features) {
      const { id, has_data } = feature.properties;
      const box = boxes.get(id);
      if (!has_data || !box || requested.current.has(id) || !boxesOverlap(box, view.bounds)) continue;
      requested.current.add(id);
      fetch(`/data/businesses/${id}.geojson`)
        .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
        .then((data: BusinessCollection) => setByDistrict((current) => ({ ...current, [id]: data })))
        .catch(() => {
          requested.current.delete(id); // try again on the next move
          setError("Some businesses didn't load. Check your connection, then move the map to retry.");
        });
    }
  }, [districts, boxes, view]);

  // One collection for the map, each business tagged with its district and rank
  const businesses = useMemo<BusinessCollection>(
    () => ({
      type: "FeatureCollection",
      features: Object.entries(byDistrict).flatMap(([district, collection]) =>
        collection.features.map((feature) => ({
          ...feature,
          properties: { ...feature.properties, district, rank: rank(feature.properties) },
        })),
      ),
    }),
    [byDistrict],
  );

  const inView = useMemo(() => {
    if (!view || !zoomedIn) return null;
    return {
      type: "FeatureCollection" as const,
      features: businesses.features.filter((feature) => inBounds(feature.geometry.coordinates, view.bounds)),
    };
  }, [businesses, view, zoomedIn]);

  // Looked up by id, so a search pick elsewhere opens once its district loads
  const selectedFeature = useMemo(
    () => businesses.features.find((feature) => feature.properties.id === selectedId) ?? null,
    [businesses, selectedId],
  );
  const selected = selectedFeature?.properties ?? null;

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
    if (!selectedFeature) return;
    navigation.open({
      id: selectedFeature.properties.id,
      name: selectedFeature.properties.name,
      position: selectedFeature.geometry.coordinates as [number, number],
    });
  }

  function selectBusiness(id: string | null) {
    // While directions are open, map clicks don't change the selection
    if (!navigation.destination) setSelectedId(id);
  }

  const tags = useMemo(
    () => (group === "all" || group === "saved" ? [] : tagOptions(inView, group)),
    [inView, group],
  );

  const counts = useMemo(() => {
    const result = Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<GroupId, number>;
    for (const feature of inView?.features ?? []) result[feature.properties.group] += 1;
    return result;
  }, [inView]);
  const inViewTotal = inView?.features.length ?? 0;

  const choices = useMemo(
    () =>
      (districts?.features ?? [])
        .map((feature) => feature.properties)
        .filter((district) => district.has_data)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [districts],
  );

  function goToDistrict(id: string) {
    setFlyToDistrict({ id, key: Date.now() });
    setError(null);
  }

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
    if (!selectedFeature) return;
    const { properties, geometry } = selectedFeature;
    toggleSaved({
      id: properties.id,
      name: properties.name,
      group: properties.group,
      category: properties.category,
      district: properties.district ?? centerDistrict,
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

  let placeLine = "Finding local businesses…";
  if (!zoomedIn) placeLine = "Zoom in to see local businesses";
  else if (centerInfo && !centerInfo.has_data) placeLine = "Not mapped yet";
  else if (inView) placeLine = `${inViewTotal.toLocaleString()} independent businesses in view`;

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div className={styles.place}>
          <p className={styles.brand}>Local Map</p>
          <h1 className={styles.placeName}>{districtTitle(centerDistrict)}</h1>
          <p className={styles.placeLine}>{placeLine}</p>
        </div>
        <SearchBox currentDistrict={centerDistrict} onPick={pickSearchResult} onPickTag={showTag} />
        <label className={styles.picker}>
          <span>Go to district</span>
          <select value={centerDistrict} onChange={(event) => goToDistrict(event.target.value)}>
            {!choices.some((district) => district.id === centerDistrict) && (
              <option value={centerDistrict}>{districtTitle(centerDistrict)}</option>
            )}
            {choices.map((district) => (
              <option key={district.id} value={district.id}>
                {districtTitle(district.id)}
              </option>
            ))}
          </select>
        </label>
      </header>

      <CategoryTabs selected={group} counts={counts} savedCount={saved.length} onChange={changeGroup} />
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
        {districts && (
          <BusinessMap
            districts={districts}
            highlightDistrictId={view ? districtAt(view.center, districts, boxes) : DEMO_DISTRICT}
            flyToDistrict={flyToDistrict}
            businesses={businesses}
            group={group}
            tag={tag}
            saved={saved}
            fitSavedKey={fitSavedKey}
            selectedId={selectedId}
            focus={focus}
            onSelect={selectBusiness}
            onSavedPick={pickSavedOnMap}
            onDistrictPick={goToDistrict}
            onViewChange={handleViewChange}
            routing={routing}
          />
        )}
        {zoomedIn && centerInfo && !centerInfo.has_data && (
          <p className={styles.status}>We haven&apos;t mapped businesses here yet. Try somewhere closer to DC.</p>
        )}
        {!zoomedIn && group !== "saved" && <p className={styles.status}>Zoom in to see local businesses</p>}
        <p className={styles.hint}>Double-click a district to jump to it</p>
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
              currentDistrict={centerDistrict}
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
