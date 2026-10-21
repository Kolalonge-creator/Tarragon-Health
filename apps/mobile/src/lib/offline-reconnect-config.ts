import { getProposedConfig } from "@tarragon/shared";

/**
 * S06y values from the versioned registry (packages/shared/src/proposed-config, key offline.reconnect_power).
 * Call sites take this object and never a literal.
 */
export interface OfflineReconnectConfig {
  version: number;
  /** Least gap between two reconnect-triggered flushes. */
  reconnectFlushMinGapMs: number;
  /** At or under this level (and not charging) the phone counts as low on power. */
  lowBatteryPercent: number;
}

export function loadOfflineReconnectConfig(): OfflineReconnectConfig {
  const entry = getProposedConfig<{ readonly [k: string]: number }>("offline.reconnect_power");
  const v = entry.value;
  const num = (name: string): number => {
    const n = v[name];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error(`offline.reconnect_power.${name} is not a positive number`);
    return n;
  };
  return {
    version: entry.version,
    reconnectFlushMinGapMs: num("reconnect_flush_min_gap_seconds") * 1000,
    lowBatteryPercent: num("low_battery_percent"),
  };
}
