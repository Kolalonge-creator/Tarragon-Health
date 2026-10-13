import { getProposedConfig } from "@tarragon/shared";

/**
 * S06x values from the versioned registry (packages/shared/src/proposed-config, key offline.trust).
 * Call sites take this object and never a literal. The device lease length also lives server-side
 * (offline_sync_config.device_lease_days); the server value wins at check-in, this one is the
 * fallback and the floor for the local expiry check.
 */
export interface OfflineTrustConfig {
  version: number;
  deviceLeaseDays: number;
  probeMinIntervalMs: number;
  probeTimeoutMs: number;
  /** After this phone first sees its own lease as lapsed while it cannot ask the server, it waits this long before wiping. */
  leaseGraceHours: number;
}

export function loadOfflineTrustConfig(): OfflineTrustConfig {
  const entry = getProposedConfig<{ readonly [k: string]: number }>("offline.trust");
  const v = entry.value;
  const num = (name: string): number => {
    const n = v[name];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error(`offline.trust.${name} is not a positive number`);
    return n;
  };
  return {
    version: entry.version,
    deviceLeaseDays: num("device_lease_days"),
    probeMinIntervalMs: num("probe_min_interval_seconds") * 1000,
    probeTimeoutMs: num("probe_timeout_seconds") * 1000,
    leaseGraceHours: num("lease_grace_hours"),
  };
}
