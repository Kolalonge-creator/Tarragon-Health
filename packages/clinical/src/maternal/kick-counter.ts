import type { MaternalConfig } from "./config";

/**
 * Baby movement counter (spec 16.7, CMO selection A3). Pure: the caller passes the movements and the clock, so the phone
 * decides offline and the server proves the same answer. This never reassures and never advises waiting: the only outcomes
 * are "keep counting", "target reached" and "contact your care team or go to a facility today" (a fixed card).
 */
export type KickState = "counting" | "target_reached" | "contact_today";
export type KickReason = "window_elapsed_without_target" | "clear_drop" | "reported_less_movement";

export interface KickSession {
  readonly startedAtMs: number;
  /** Time of each movement the person tapped, in ms, any order. */
  readonly movementMs: readonly number[];
  /** True when she pressed "I feel less movement than usual". Always the fixed card, at once. */
  readonly reportedLess?: boolean;
}

export interface KickEvaluation {
  readonly state: KickState;
  readonly reason: KickReason | null;
  readonly count: number;
  /** Minutes until the target was reached, when it was. */
  readonly minutesToTarget: number | null;
  readonly elapsedMinutes: number;
}

export interface FinishedKickSession {
  /** Null when the target was not reached. */
  readonly minutesToTarget: number | null;
}

/** Whether the counter is offered at this week (from the configured start week). An unknown week is not offered. */
export function kickCounterAvailable(week: number | null, config: MaternalConfig): boolean {
  return week !== null && week >= config.kicks.startWeek;
}

/**
 * Her own normal: the median minutes to reach the target over her latest finished sessions that did reach it. Null until she
 * has enough sessions, so a new user is judged on the fixed rule alone and never on a baseline of one or two tries.
 */
export function personalNormalMinutes(history: readonly FinishedKickSession[], config: MaternalConfig): number | null {
  const reached = history
    .slice(-config.kicks.normalLatestSessions)
    .map((s) => s.minutesToTarget)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0);
  if (reached.length < config.kicks.normalMinSessions) return null;
  const sorted = [...reached].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return median;
}

export function evaluateKickSession(session: KickSession, nowMs: number, normalMinutes: number | null, config: MaternalConfig): KickEvaluation {
  const { windowMinutes, movementsTarget, dropFactor } = config.kicks;
  const windowMs = windowMinutes * 60_000;
  const inWindow = [...session.movementMs].filter((t) => t >= session.startedAtMs && t <= session.startedAtMs + windowMs).sort((a, b) => a - b);
  const count = inWindow.length;
  const elapsedMinutes = Math.max(0, (nowMs - session.startedAtMs) / 60_000);
  const reached = count >= movementsTarget ? inWindow[movementsTarget - 1]! : null;
  const minutesToTarget = reached === null ? null : Math.max(0, (reached - session.startedAtMs) / 60_000);
  const base = { count, minutesToTarget, elapsedMinutes };

  if (session.reportedLess === true) return { ...base, state: "contact_today", reason: "reported_less_movement" };
  if (minutesToTarget !== null) {
    if (normalMinutes !== null && normalMinutes > 0 && minutesToTarget >= dropFactor * normalMinutes) {
      return { ...base, state: "contact_today", reason: "clear_drop" };
    }
    return { ...base, state: "target_reached", reason: null };
  }
  if (elapsedMinutes >= windowMinutes) return { ...base, state: "contact_today", reason: "window_elapsed_without_target" };
  if (normalMinutes !== null && normalMinutes > 0 && elapsedMinutes >= dropFactor * normalMinutes) {
    return { ...base, state: "contact_today", reason: "clear_drop" };
  }
  return { ...base, state: "counting", reason: null };
}
