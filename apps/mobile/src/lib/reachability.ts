import { addDataUsage } from "./data-usage";
import { loadOfflineTrustConfig } from "./offline-trust-config";
import { looksConnected, shouldProbe, type NetState } from "./reachability-rules";
import { recordSyncError } from "./sync-diagnostics";

/**
 * The honest reconnect trigger (S06x). The operating system's "connected" is a claim: a phone on a
 * captive-portal wifi or a SIM with no data reports connected and cannot reach anything. So when the
 * radio says it is back AND entries are waiting, one HEAD request (no body) to our own API decides
 * whether to flush. At most one probe per minute while entries wait; none at all with an empty outbox.
 *
 * This ADDS a trigger. The foreground flush and the one-minute loop in App.tsx and the background task
 * stay exactly as they were, so a phone where NetInfo is missing or silent syncs as before.
 */

/** Estimated bytes for one HEAD request and its reply, counted by the data meter. */
const PROBE_BYTES_ESTIMATE = 400;

export async function probeReachable(timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const apikey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !apikey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any HTTP answer, even 401, proves the server was reached. Only a thrown request means "not reachable".
    await fetchImpl(`${base}/rest/v1/`, { method: "HEAD", headers: { apikey }, signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface WatcherDeps {
  /** How many entries are waiting to go. */
  rowsWaiting: () => Promise<number>;
  /** Called when the probe proves the server is reachable. */
  onReachable: () => Promise<unknown> | void;
}

export interface WatcherIo {
  subscribe: (listener: (state: NetState) => void) => () => void;
  probe: (timeoutMs: number) => Promise<boolean>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

async function defaultSubscribe(listener: (state: NetState) => void): Promise<() => void> {
  try {
    const mod = await import("@react-native-community/netinfo");
    const NetInfo = mod.default;
    return NetInfo.addEventListener((s) => listener({ isConnected: s.isConnected, isInternetReachable: s.isInternetReachable }));
  } catch (error) {
    // No NetInfo on this binary: the foreground and one-minute flush carry on alone.
    recordSyncError("offline_outbox", "netinfo:unavailable", error);
    return () => {};
  }
}

const defaultIo: WatcherIo = {
  subscribe: (listener) => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void defaultSubscribe(listener).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },
  probe: (timeoutMs) => probeReachable(timeoutMs),
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

/**
 * Starts watching. Returns a function that stops it. A probe runs when the radio reports a usable
 * connection, and again once a minute while the last probe failed and entries still wait.
 */
export function startReconnectWatcher(deps: WatcherDeps, io: WatcherIo = defaultIo): () => void {
  const config = loadOfflineTrustConfig();
  let lastProbeAt: number | null = null;
  let lastProbeFailed = false;
  let inFlight = false;
  let connected = false;

  const attempt = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const rowsWaiting = await deps.rowsWaiting().catch(() => 0);
      const now = io.now();
      if (!shouldProbe({ now, lastProbeAt, minIntervalMs: config.probeMinIntervalMs, rowsWaiting })) return;
      lastProbeAt = now;
      const reachable = await io.probe(config.probeTimeoutMs);
      await addDataUsage(PROBE_BYTES_ESTIMATE);
      lastProbeFailed = !reachable;
      if (reachable) await deps.onReachable();
    } catch (error) {
      recordSyncError("offline_outbox", "reachability:attempt", error);
    } finally {
      inFlight = false;
    }
  };

  const unsubscribe = io.subscribe((state) => {
    const was = connected;
    connected = looksConnected(state);
    // A transition to connected is the trigger; repeated reports of the same state are not.
    if (connected && !was) void attempt();
  });
  // A failed probe (captive portal, weak signal) is retried once a minute, no faster, only while entries wait.
  const timer = io.setInterval(() => {
    if (connected && lastProbeFailed) void attempt();
  }, config.probeMinIntervalMs);

  return () => {
    unsubscribe();
    io.clearInterval(timer);
  };
}
