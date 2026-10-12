"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { GroupId } from "@/types/business";

/**
 * Saved spots live in this browser's localStorage: no account, no server.
 * Each one keeps enough to list it and fly to it without loading its district.
 */
export interface SavedSpot {
  id: string;
  name: string;
  group: GroupId;
  category: string;
  district: string;
  lng: number;
  lat: number;
  city?: string;
}

const STORAGE_KEY = "local-map:saved:v1";
const EMPTY: SavedSpot[] = [];
const listeners = new Set<() => void>();

// useSyncExternalStore needs the same array back until the data changes
let cache: { raw: string | null; spots: SavedSpot[] } = { raw: null, spots: EMPTY };

function read(): SavedSpot[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: saving just won't persist
  }
  if (raw !== cache.raw) {
    let spots = EMPTY;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) spots = parsed;
    } catch {
      // Corrupt value: start over
    }
    cache = { raw, spots };
  }
  return cache.spots;
}

function write(spots: SavedSpot[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  } catch {
    // Storage full or blocked: keep working for this visit
    cache = { raw: JSON.stringify(spots), spots };
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Saves made in another tab
  const onStorage = (event: StorageEvent) => event.key === STORAGE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSaved() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);

  const isSaved = useCallback((id: string) => saved.some((spot) => spot.id === id), [saved]);

  const toggle = useCallback((spot: SavedSpot) => {
    const current = read();
    write(
      current.some((s) => s.id === spot.id) ? current.filter((s) => s.id !== spot.id) : [spot, ...current],
    );
  }, []);

  const remove = useCallback((id: string) => write(read().filter((s) => s.id !== id)), []);

  return { saved, isSaved, toggle, remove };
}
