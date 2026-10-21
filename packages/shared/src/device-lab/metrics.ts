import type { DeviceLabBudgets } from "./budgets";

/** One catalogue of metric ids, units, order and budgets, shared by the Android, iOS and hand-entered collectors. */
export const METRIC_IDS = {
  coldStart: "cold_start_ms",
  coldStartUsable: "cold_start_usable_ms",
  size: "installed_size_mb",
  sizeSettings: "installed_size_settings_mb",
  memory: "memory_after_offline_flow_mb",
  logWrite: "log_store_write_ms",
  logVisible: "log_visible_ms",
  reconnect: "reconnect_flush_seconds",
  probe: "probe_requests_per_minute",
} as const;

export type MetricId = (typeof METRIC_IDS)[keyof typeof METRIC_IDS];

/** Report order. */
export const METRIC_ORDER: readonly MetricId[] = [
  METRIC_IDS.coldStart, METRIC_IDS.coldStartUsable, METRIC_IDS.size, METRIC_IDS.sizeSettings, METRIC_IDS.memory,
  METRIC_IDS.logWrite, METRIC_IDS.logVisible, METRIC_IDS.reconnect, METRIC_IDS.probe,
];

/** Ids a person may pass with --manual. cold_start_ms and installed_size_mb are only ever measured by the harness. */
export const MANUAL_IDS: readonly string[] = [
  METRIC_IDS.coldStartUsable, METRIC_IDS.sizeSettings, METRIC_IDS.memory, METRIC_IDS.logWrite, METRIC_IDS.logVisible, METRIC_IDS.reconnect, METRIC_IDS.probe,
];

export const METRIC_UNITS: Readonly<Record<MetricId, string>> = {
  [METRIC_IDS.coldStart]: "ms",
  [METRIC_IDS.coldStartUsable]: "ms",
  [METRIC_IDS.size]: "MB",
  [METRIC_IDS.sizeSettings]: "MB",
  [METRIC_IDS.memory]: "MB",
  [METRIC_IDS.logWrite]: "ms",
  [METRIC_IDS.logVisible]: "ms",
  [METRIC_IDS.reconnect]: "s",
  [METRIC_IDS.probe]: "requests/min",
};

export function budgetFor(id: string, b: DeviceLabBudgets): number | null {
  switch (id) {
    case METRIC_IDS.coldStart:
    case METRIC_IDS.coldStartUsable: return b.coldStartMsMax;
    case METRIC_IDS.size:
    case METRIC_IDS.sizeSettings: return b.installedSizeMbMax;
    case METRIC_IDS.memory: return b.memoryMbMax;
    case METRIC_IDS.logWrite: return b.logStoreWriteMsMax;
    case METRIC_IDS.logVisible: return b.logVisibleMsMax;
    case METRIC_IDS.reconnect: return b.reconnectFlushSecondsMax;
    case METRIC_IDS.probe: return b.probeRequestsPerMinuteMax;
    default: return null;
  }
}
