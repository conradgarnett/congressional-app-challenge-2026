"use client";

import { useSyncExternalStore } from "react";

import type { RouteSession } from "@/hooks/useRouteSession";
import { formatDistance, formatDuration } from "@/lib/routing/format";
import type { TravelMode } from "@/types/routing";
import styles from "./Sidebar.module.css";

const MODES: { id: TravelMode; label: string }[] = [
  { id: "pedestrian", label: "Walk" },
  { id: "bicycle", label: "Bike" },
  { id: "auto", label: "Drive" },
];

// "Simulate trip" shows only with ?demo in the address, for testing and demo videos
const subscribeNever = () => () => {};
const readDemoFlag = () => new URLSearchParams(window.location.search).has("demo");

/** Getting to a business: where from, how, the route, and live turn-by-turn. */
export default function DirectionsView({ session }: { session: RouteSession }) {
  const demo = useSyncExternalStore(subscribeNever, readDemoFlag, () => false);
  const { destination, route, progress, live } = session;
  if (!destination) return null;
  const next = progress && route ? route.maneuvers[progress.maneuverIndex] : null;

  let from = "Finding your location…";
  if (session.picking) from = "Click the map where you’re starting";
  else if (session.start?.source === "map") from = "The point you picked on the map";
  else if (session.start) from = "Your location";
  else if (session.locationError) from = session.locationError;

  return (
    <section className={styles.detail} aria-label="Directions">
      <button type="button" className={styles.back} onClick={session.close}>
        Close directions
      </button>
      <h2 className={styles.detailName}>To {destination.name}</h2>

      {live && progress && (
        <div className={styles.nextTurn} role="status">
          {progress.arrived ? (
            <p>You’ve arrived at {destination.name}.</p>
          ) : (
            <>
              <p className={styles.nextTurnText}>{next?.verbal ?? next?.instruction ?? "Continue on the route"}</p>
              <p>
                In {formatDistance(progress.toNextMeters)}, then {formatDistance(progress.remainingMeters)} left
              </p>
            </>
          )}
        </div>
      )}

      <dl className={styles.facts}>
        <dt>From</dt>
        <dd>
          {from}
          <span className={styles.inlineActions}>
            <button type="button" className={styles.link} onClick={session.locate} disabled={session.locating}>
              Use my location
            </button>
            <button type="button" className={styles.link} onClick={session.pickStart}>
              Pick on the map
            </button>
          </span>
        </dd>
      </dl>

      <div className={styles.modes} role="radiogroup" aria-label="Travel by">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={session.mode === mode.id}
            className={styles.mode}
            onClick={() => session.setMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {session.loading && <p className={styles.listNote}>Finding a route…</p>}
      {session.routeError && <p className={styles.error}>No route found: {session.routeError}</p>}
      {route && (
        <>
          <p className={styles.summary}>
            <strong>{formatDuration(route.durationSeconds)}</strong> for {formatDistance(route.distanceMeters)}
          </p>
          <div className={styles.actions}>
            {live ? (
              <button type="button" className={styles.secondary} onClick={session.stopLive}>
                Stop navigation
              </button>
            ) : (
              <>
                <button type="button" className={styles.primary} onClick={() => session.startLive("gps")}>
                  Start navigation
                </button>
                {demo && (
                  <button type="button" className={styles.secondary} onClick={() => session.startLive("demo")}>
                    Simulate trip
                  </button>
                )}
              </>
            )}
          </div>
          <ol className={styles.steps}>
            {route.maneuvers.map((maneuver, i) => (
              <li key={i} aria-current={progress?.maneuverIndex === i ? "step" : undefined}>
                <span>{maneuver.instruction}</span>
                {maneuver.lengthMeters > 0 && <span className={styles.rowMeta}>{formatDistance(maneuver.lengthMeters)}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
