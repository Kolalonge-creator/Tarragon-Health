import * as SecureStore from "expo-secure-store";
import { fetchVitalsThresholds } from "./api";
import { GLUCOSE_THRESHOLDS, type GlucoseThresholds } from "./glucose-red-flags";
import { BP_THRESHOLDS, type BpThresholds } from "./bp-classification";

/**
 * Keeps the bundled offline classifiers (glucose-red-flags.ts,
 * bp-classification.ts) from silently drifting out of lock-step with the
 * server's thresholds. The bundled DEFAULT_* constants below are the source
 * of truth whenever the phone has never synced or is offline; a newer,
 * server-reported version replaces them in a small SecureStore cache, same
 * cache-with-fallback shape as emergency.ts's loadCachedEmergencyFacts().
 *
 * This never blocks classification — loadActiveThresholds() always resolves
 * synchronously-fast from cache-or-default, and syncThresholdsIfOnline() is
 * a fire-and-forget best-effort call from App.tsx (on foreground) and from
 * offline-vitals-queue.ts (after a successful flush), not a gate in front of
 * logging a reading.
 */

const CACHE_KEY = "vitals-thresholds-cache-v1";

/** Bundled snapshot matching the server as of this file's last edit — bump
 * alongside apps/web/src/lib/vitals/mobile-thresholds.ts's
 * MOBILE_THRESHOLDS_VERSION whenever a threshold value changes. */
export const DEFAULT_VERSION = "glucose:2026-09-01.1|bp:2026-09-01.1";

interface CachedThresholds {
  version: string;
  glucose: GlucoseThresholds;
  bp: BpThresholds;
}

const DEFAULT_THRESHOLDS: CachedThresholds = {
  version: DEFAULT_VERSION,
  glucose: GLUCOSE_THRESHOLDS,
  bp: BP_THRESHOLDS,
};

export async function loadActiveThresholds(): Promise<CachedThresholds> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    const cached = JSON.parse(raw) as CachedThresholds;
    return cached.version && cached.glucose && cached.bp ? cached : DEFAULT_THRESHOLDS;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/** Best-effort — fetches the server's current thresholds and caches them
 * only if the version actually differs from what's already active, so an
 * offline call is a harmless no-op. Never throws. */
export async function syncThresholdsIfOnline(): Promise<void> {
  try {
    const remote = await fetchVitalsThresholds();
    if (!remote) return;
    const active = await loadActiveThresholds();
    if (remote.version === active.version) return;

    const next: CachedThresholds = {
      version: remote.version,
      glucose: { ...DEFAULT_THRESHOLDS.glucose, ...(remote.glucose as Partial<GlucoseThresholds>) },
      bp: { ...DEFAULT_THRESHOLDS.bp, ...(remote.bp as Partial<BpThresholds>) },
    };
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort — a failed sync just means classification keeps using
    // whatever was already active (cache or bundled default).
  }
}
