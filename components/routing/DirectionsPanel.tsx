"use client";

import { useSyncExternalStore } from "react";

import type { RouteSession } from "@/hooks/useRouteSession";
import { formatDistance, formatDuration } from "@/lib/routing/format";
import type { TravelMode } from "@/types/routing";
import styles from "./DirectionsPanel.module.css";

const MODES: { id: TravelMode; label: string }[] = [
  { id: "pedestrian", label: "Walk" },
  { id: "bicycle", label: "Bike" },
  { id: "auto", label: "Drive" },
];

// "Simulate trip" shows only with ?demo in the address, for testing and demo videos
const subscribeNever = () => () => {};
const readDemoFlag = () => new URLSearchParams(window.location.search).has("demo");
const serverDemoFlag = () => false;

interface Props {
  session: RouteSession;
}

export default function DirectionsPanel({ session }: Props) {
  const demoAvailable = useSyncExternalStore(subscribeNever, readDemoFlag, serverDemoFlag);
  const { destination, route, progress, live } = session;
  if (!destination) return null;

  const nextManeuver = progress && route ? route.maneuvers[progress.maneuverIndex] : null;

  let startLabel = "Not set";
  if (session.locating) startLabel = "Finding your location…";
  else if (session.picking) startLabel = "Click the map to choose";
  else if (session.start?.source === "gps") startLabel = "Your location";
  else if (session.start?.source === "map") startLabel = "Point on the map";

  return (
    <aside className={styles.panel} aria-label={`Directions to ${destination.name}`}>
      <button type="button" className={styles.close} onClick={session.close} aria-label="Close directions">
        ×
      </button>
      <p className={styles.eyebrow}>Directions to</p>
      <h2 className={styles.title}>{destination.name}</h2>

      {live && progress && (
        <div className={styles.banner} role="status" aria-live="polite">
          {progress.arrived ? (
            <p className={styles.bannerMain}>You have arrived.</p>
          ) : (
            <>
              <p className={styles.bannerMain}>{nextManeuver?.instruction}</p>
              <p className={styles.bannerSub}>
                In {formatDistance(progress.toNextMeters)} · {formatDistance(progress.remainingMeters)} left
              </p>
            </>
          )}
        </div>
      )}
      {live && !progress && (
        <div className={styles.banner} role="status">
          <p className={styles.bannerSub}>Waiting for your location…</p>
        </div>
      )}

      {!live && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>From</span>
            <span className={styles.value}>{startLabel}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.link} onClick={session.locate} disabled={session.locating}>
              Use my location
            </button>
            <button type="button" className={styles.link} onClick={session.pickStart}>
              Choose on map
            </button>
          </div>
          {session.locationError && <p className={styles.error}>{session.locationError}</p>}

          <div className={styles.modes} role="radiogroup" aria-label="Travel mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={session.mode === m.id}
                className={styles.mode}
                onClick={() => session.setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      {session.loading && !route && <p className={styles.muted}>Finding a route…</p>}
      {session.routeError && <p className={styles.error}>Couldn&apos;t find a route: {session.routeError}</p>}

      {route && (
        <>
          {!live && (
            <p className={styles.summary}>
              <strong>{formatDuration(route.durationSeconds)}</strong> · {formatDistance(route.distanceMeters)}
            </p>
          )}

          <div className={styles.buttons}>
            {live ? (
              <button type="button" className={styles.primary} onClick={session.stopLive}>
                Stop navigation
              </button>
            ) : (
              <>
                <button type="button" className={styles.primary} onClick={() => session.startLive("gps")}>
                  Start navigation
                </button>
                {demoAvailable && (
                  <button type="button" className={styles.secondary} onClick={() => session.startLive("demo")}>
                    Simulate trip
                  </button>
                )}
              </>
            )}
          </div>

          <details className={styles.steps} open={!live}>
            <summary>{route.maneuvers.length} steps</summary>
            <ol>
              {route.maneuvers.map((maneuver, i) => (
                <li key={i} aria-current={live && progress?.maneuverIndex === i ? "step" : undefined}>
                  <span>{maneuver.instruction}</span>
                  {maneuver.lengthMeters > 0 && (
                    <span className={styles.stepDistance}>{formatDistance(maneuver.lengthMeters)}</span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      <p className={styles.credit}>
        Routes by{" "}
        <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener noreferrer">
          Valhalla
        </a>{" "}
        on OpenStreetMap data.
      </p>
    </aside>
  );
}
