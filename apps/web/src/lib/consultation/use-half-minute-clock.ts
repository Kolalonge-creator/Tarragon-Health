"use client";

import { useSyncExternalStore } from "react";

/** How often the clock ticks, and the step it is rounded down to. */
const STEP_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, STEP_MS);
  return () => clearInterval(id);
}

/** Rounded down to the step, so consecutive reads agree (as useSyncExternalStore requires) and a window never opens early. */
function getSnapshot(): number {
  return Math.floor(Date.now() / STEP_MS) * STEP_MS;
}

/** No clock on the server: anything time-gated stays hidden until the browser has read its own time. */
function getServerSnapshot(): null {
  return null;
}

/**
 * The current time in milliseconds, refreshed every 30 seconds, or null during the server render and hydration. Used to show a
 * time-gated control (the consultation Join button) at the right moment without reloading the page.
 */
export function useHalfMinuteClock(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
