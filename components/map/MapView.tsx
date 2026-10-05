"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import BusinessPanel from "@/components/business/BusinessPanel";
import CategoryTabs from "@/components/business/CategoryTabs";
import SearchBox from "@/components/business/SearchBox";
import DirectionsPanel from "@/components/routing/DirectionsPanel";
import { useRouteSession } from "@/hooks/useRouteSession";
import { GROUPS, type GroupFilter } from "@/lib/groups";
import type { SearchEntry } from "@/lib/search";
import type { BusinessCollection, DistrictCollection, GroupId } from "@/types/business";
import styles from "./MapView.module.css";

// MapLibre needs the browser (window, WebGL), so skip server rendering
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false });

const DEMO_DISTRICT = "MD-08";

const STATE_NAMES: Record<string, string> = { DC: "District of Columbia", MD: "Maryland", VA: "Virginia" };

function districtLabel(id: string): string {
  const [state, number] = id.split("-");
  if (number === "AL") return STATE_NAMES[state] ?? id;
  return `${STATE_NAMES[state] ?? state} ${Number(number)}`;
}

export default function MapView() {
  const [districts, setDistricts] = useState<DistrictCollection | null>(null);
  const [districtId, setDistrictId] = useState(DEMO_DISTRICT);
  const [loadedBusinesses, setLoadedBusinesses] = useState<{ districtId: string; data: BusinessCollection } | null>(
    null,
  );
  const [group, setGroup] = useState<GroupFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigation = useRouteSession();

  useEffect(() => {
    fetch("/data/districts.geojson")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then(setDistricts)
      .catch(() => setError("Could not load district boundaries."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/data/businesses/${districtId}.geojson`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then((data: BusinessCollection) => {
        if (!cancelled) setLoadedBusinesses({ districtId, data });
      })
      .catch(() => {
        if (!cancelled) setError(`Could not load businesses for ${districtId}.`);
      });
    return () => {
      cancelled = true;
    };
  }, [districtId]);

  // Ignore data from the previous district while the new one loads
  const businesses = loadedBusinesses?.districtId === districtId ? loadedBusinesses.data : null;

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
    setDistrictId(id);
    setSelectedId(null);
    setError(null);
  }

  function changeGroup(next: GroupFilter) {
    setGroup(next);
    if (selected && next !== "all" && selected.group !== next) setSelectedId(null);
  }

  function pickSearchResult(entry: SearchEntry) {
    if (entry.district !== districtId) changeDistrict(entry.district);
    if (group !== "all" && group !== entry.group) setGroup("all");
    setSelectedId(entry.id);
    setFocus({ lng: entry.lng, lat: entry.lat, key: Date.now() });
  }

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Local Map</h1>
          <p className={styles.subtitle}>Independent small businesses, by congressional district</p>
        </div>
        <SearchBox currentDistrict={districtId} onPick={pickSearchResult} />
        <label className={styles.picker}>
          <span>District</span>
          <select value={districtId} onChange={(event) => changeDistrict(event.target.value)}>
            {choices.length === 0 && <option value={districtId}>{districtLabel(districtId)}</option>}
            {choices.map((district) => (
              <option key={district.id} value={district.id}>
                {districtLabel(district.id)} ({district.id})
              </option>
            ))}
          </select>
        </label>
      </header>

      <CategoryTabs selected={group} counts={counts} onChange={changeGroup} />

      <div className={styles.mapArea}>
        {districts && (
          <BusinessMap
            districts={districts}
            districtId={districtId}
            businesses={businesses}
            group={group}
            selectedId={selectedId}
            focus={focus}
            onSelect={selectBusiness}
            routing={routing}
          />
        )}
        {!businesses && !error && <p className={styles.status}>Loading businesses…</p>}
        {error && <p className={styles.status}>{error}</p>}
        {navigation.destination ? (
          <DirectionsPanel session={navigation} />
        ) : (
          selected && (
            <BusinessPanel business={selected} onClose={() => setSelectedId(null)} onDirections={openDirections} />
          )
        )}
      </div>
    </div>
  );
}
