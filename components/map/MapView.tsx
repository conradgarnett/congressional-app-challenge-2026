"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import BusinessPanel from "@/components/business/BusinessPanel";
import CategoryTabs from "@/components/business/CategoryTabs";
import SavedPanel from "@/components/business/SavedPanel";
import SearchBox from "@/components/business/SearchBox";
import TagFilter from "@/components/business/TagFilter";
import DirectionsPanel from "@/components/routing/DirectionsPanel";
import { useRouteSession } from "@/hooks/useRouteSession";
import { useSaved, type SavedSpot } from "@/hooks/useSaved";
import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { SearchEntry } from "@/lib/search";
import { hasTag, tagOptions } from "@/lib/tags";
import type { BusinessCollection, DistrictCollection, GroupId } from "@/types/business";
import styles from "./MapView.module.css";

// MapLibre needs the browser (window, WebGL), so skip server rendering
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false });

const DEMO_DISTRICT = "MD-08";

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

export default function MapView() {
  const [districts, setDistricts] = useState<DistrictCollection | null>(null);
  const [districtId, setDistrictId] = useState(DEMO_DISTRICT);
  const [loadedBusinesses, setLoadedBusinesses] = useState<{ districtId: string; data: BusinessCollection } | null>(
    null,
  );
  const [group, setGroup] = useState<GroupFilter>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigation = useRouteSession();
  const { saved, isSaved, toggle: toggleSaved, remove: removeSaved } = useSaved();
  const savedIds = useMemo(() => saved.map((spot) => spot.id), [saved]);

  useEffect(() => {
    fetch("/data/districts.geojson")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then(setDistricts)
      .catch(() => setError("The district map didn't load. Check your connection and refresh the page."));
  }, []);

  // Districts outside the metro area have no business file yet
  const districtInfo = districts?.features.find((feature) => feature.properties.id === districtId)?.properties;
  const noData = districtInfo !== undefined && !districtInfo.has_data;

  useEffect(() => {
    if (noData) return;
    let cancelled = false;
    fetch(`/data/businesses/${districtId}.geojson`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then((data: BusinessCollection) => {
        if (!cancelled) setLoadedBusinesses({ districtId, data });
      })
      .catch(() => {
        if (!cancelled) setError("Businesses for this district didn't load. Check your connection and refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, [districtId, noData]);

  // Ignore data from the previous district while the new one loads
  const businesses = !noData && loadedBusinesses?.districtId === districtId ? loadedBusinesses.data : null;

  // Looked up by id so a search pick in another district opens once its data arrives
  const selectedFeature = useMemo(
    () => businesses?.features.find((feature) => feature.properties.id === selectedId) ?? null,
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
    () => (group === "all" || group === "saved" ? [] : tagOptions(businesses, group)),
    [businesses, group],
  );

  const counts = useMemo(() => {
    const result = Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<GroupId, number>;
    for (const feature of businesses?.features ?? []) result[feature.properties.group] += 1;
    return result;
  }, [businesses]);

  const choices = useMemo(
    () =>
      (districts?.features ?? [])
        .map((feature) => feature.properties)
        .filter((district) => district.has_data)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [districts],
  );

  function changeDistrict(id: string) {
    if (id === districtId) return;
    setDistrictId(id);
    setSelectedId(null);
    setTag(null); // the new district may not have this type
    setError(null);
  }

  function changeGroup(next: GroupFilter) {
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
      district: districtId,
      city: properties.city,
      lng: geometry.coordinates[0],
      lat: geometry.coordinates[1],
    });
  }

  function openSaved(spot: SavedSpot) {
    if (spot.district !== districtId) changeDistrict(spot.district);
    setSelectedId(spot.id);
    setFocus({ lng: spot.lng, lat: spot.lat, key: Date.now() });
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
    if (entry.district !== districtId) changeDistrict(entry.district);
    if (group !== "all" && (group === "saved" ? !isSaved(entry.id) : group !== entry.group)) setGroup("all");
    setTag(null); // a search pick must not be hidden by a type filter
    setSelectedId(entry.id);
    setFocus({ lng: entry.lng, lat: entry.lat, key: Date.now() });
  }

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div className={styles.place}>
          <p className={styles.brand}>Local Map</p>
          <h1 className={styles.placeName}>{districtTitle(districtId)}</h1>
          <p className={styles.placeLine}>
            {noData
              ? "Not mapped yet"
              : businesses
                ? `${businesses.features.length.toLocaleString()} independent businesses on the map`
                : "Finding local businesses…"}
          </p>
        </div>
        <SearchBox currentDistrict={districtId} onPick={pickSearchResult} onPickTag={showTag} />
        <label className={styles.picker}>
          <span>Switch district</span>
          <select value={districtId} onChange={(event) => changeDistrict(event.target.value)}>
            {!choices.some((district) => district.id === districtId) && (
              <option value={districtId}>{districtTitle(districtId)}</option>
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
            districtId={districtId}
            businesses={businesses}
            group={group}
            tag={tag}
            savedIds={savedIds}
            selectedId={selectedId}
            focus={focus}
            onSelect={selectBusiness}
            onDistrictPick={changeDistrict}
            routing={routing}
          />
        )}
        {noData && (
          <p className={styles.status}>
            We haven&apos;t mapped businesses here yet. Try a district closer to DC.
          </p>
        )}
        {!businesses && !noData && !error && <p className={styles.status}>Finding local businesses…</p>}
        <p className={styles.hint}>Double-click a district to switch to it</p>
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
            <SavedPanel saved={saved} currentDistrict={districtId} onOpen={openSaved} onRemove={removeSaved} />
          )
        )}
      </div>
    </div>
  );
}
