import { useSyncExternalStore } from "react";
import { isLowDataActive, subscribeLowData } from "./offline-budget";

/**
 * True while low-data mode is on. Re-renders the screen when the Settings switch flips.
 * Pair it with `mediaDecision()` (media-policy.ts) to decide whether an image loads by
 * itself or waits for a tap. The preference is read from the phone first (low-data.ts),
 * so it works offline.
 */
export function useLowData(): boolean {
  return useSyncExternalStore(subscribeLowData, isLowDataActive, () => false);
}
