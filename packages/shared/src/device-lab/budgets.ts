import { getProposedConfig } from "../proposed-config/index";

/** The device lab budgets. Loaded from versioned configuration (`device_lab.budgets`), never typed in here. */
export interface DeviceLabBudgets {
  readonly coldStartMsMax: number;
  readonly coldStartRuns: number;
  readonly installedSizeMbMax: number;
  /** null means "no budget set": the harness records the number and says so. */
  readonly memoryMbMax: number | null;
  readonly logStoreWriteMsMax: number;
  readonly logVisibleMsMax: number;
  readonly logLatencyRuns: number;
  readonly reconnectFlushSecondsMax: number;
  readonly probeRequestsPerMinuteMax: number;
  readonly enforcement: "report_only";
  readonly configVersion: number;
  readonly configStatus: "proposed" | "confirmed";
}

const BYTES_PER_MB = 1_000_000;
export const bytesToMb = (bytes: number): number => bytes / BYTES_PER_MB;

function num(raw: Record<string, unknown>, key: string): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`device_lab.budgets.${key} must be a non-negative number`);
  }
  return v;
}

export function parseDeviceLabBudgets(
  value: unknown,
  meta: { version: number; status: "proposed" | "confirmed" },
): DeviceLabBudgets {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("device_lab.budgets must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw["enforcement"] !== "report_only") {
    // OQ: budgets are reported, not gated. A future gated mode is a new decision, not something this loader invents.
    throw new Error('device_lab.budgets.enforcement must be "report_only"');
  }
  const memory = raw["memory_mb_max"];
  if (memory !== null && (typeof memory !== "number" || !Number.isFinite(memory) || memory < 0)) {
    throw new Error("device_lab.budgets.memory_mb_max must be null or a non-negative number");
  }
  return {
    coldStartMsMax: num(raw, "cold_start_ms_max"),
    coldStartRuns: Math.max(1, Math.floor(num(raw, "cold_start_runs"))),
    installedSizeMbMax: num(raw, "installed_size_mb_max"),
    memoryMbMax: memory as number | null,
    logStoreWriteMsMax: num(raw, "log_store_write_ms_max"),
    logVisibleMsMax: num(raw, "log_visible_ms_max"),
    logLatencyRuns: Math.max(1, Math.floor(num(raw, "log_latency_runs"))),
    reconnectFlushSecondsMax: num(raw, "reconnect_flush_seconds_max"),
    probeRequestsPerMinuteMax: num(raw, "probe_requests_per_minute_max"),
    enforcement: "report_only",
    configVersion: meta.version,
    configStatus: meta.status,
  };
}

export function loadDeviceLabBudgets(asOf?: string): DeviceLabBudgets {
  const cfg = getProposedConfig("device_lab.budgets", asOf);
  return parseDeviceLabBudgets(cfg.value, { version: cfg.version, status: cfg.status });
}
