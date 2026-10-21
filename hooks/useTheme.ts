"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/*
 * Light or dark: the visitor's choice, or their computer's setting ("auto").
 * The choice is kept in this browser. The resolved theme is set on <html
 * data-theme> for the interface colors (app/globals.css) and passed to the
 * map, which swaps to Organic Maps' dark palette and icons.
 */

export type ThemeChoice = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const STORAGE_KEY = "local-map:theme:v1";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

function readTheme(): string {
  const choice = readChoice();
  const resolved = choice === "auto" ? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light") : choice;
  return `${choice}:${resolved}`;
}

export function useTheme() {
  const [choice, theme] = useSyncExternalStore(subscribe, readTheme, () => "auto:light").split(":") as [
    ThemeChoice,
    Theme,
  ];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const choose = useCallback((next: ThemeChoice) => {
    try {
      if (next === "auto") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page reloads
    }
    for (const listener of listeners) listener();
  }, []);

  return { choice, theme, choose };
}
