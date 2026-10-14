/**
 * Pure rules for the reconnect trigger (S06x). No I/O.
 */

export interface NetState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/** The radio claims a connection and the OS has not said the internet is unreachable. A claim, not proof: the probe is the proof. */
export function looksConnected(state: NetState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/**
 * Whether to spend a request on a reachability probe. Only while entries are waiting (a phone with an
 * empty outbox never probes) and never more than once per minInterval.
 */
export function shouldProbe(input: { now: number; lastProbeAt: number | null; minIntervalMs: number; rowsWaiting: number }): boolean {
  if (input.rowsWaiting <= 0) return false;
  return input.lastProbeAt === null || input.now - input.lastProbeAt >= input.minIntervalMs;
}
