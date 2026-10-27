/**
 * The visible countdown for "measure again" (the repeat the CMO-signed blood pressure rule set asks for: 5 minutes for the first
 * elevated reading, 2 hours after a very high one with no symptom). The phone already stored the reading and scheduled a reminder;
 * what was missing was anything on the screen that said WHEN. Pure: no clock of its own, no I/O.
 *
 * This module only reads the time the engine asked for (`afterMinutes`, saved with the pending recheck). It adds no clinical wording
 * and no threshold, grades nothing, and never delays or hides emergency guidance: the emergency modal and the symptom question
 * are rendered by their own code paths and this card is only ever an addition beside them (INV-01).
 */
export const LAGOS_TZ = "Africa/Lagos";

export type RecheckCountdown =
  | { state: "waiting"; dueAtMs: number; minutesLeft: number; dueTime: string }
  | { state: "due"; dueAtMs: number; dueTime: string }
  | { state: "none" };

/** "14:05" in Lagos time, 24 hour clock, whatever the phone's own time zone says. */
export function lagosClock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/**
 * @param dueAtMs when the repeat is due, or null when unknown (an older saved recheck with no stored time shows nothing rather than a guess)
 * @param nowMs   the current time
 * @param expiryMs when the signed window for the repeat ends and the phone grades the first reading as if repeated; the card goes away then
 */
export function recheckCountdown(dueAtMs: number | null | undefined, nowMs: number, expiryMs: number | null = null): RecheckCountdown {
  if (dueAtMs === null || dueAtMs === undefined || !Number.isFinite(dueAtMs) || !Number.isFinite(nowMs)) return { state: "none" };
  if (expiryMs !== null && Number.isFinite(expiryMs) && nowMs > expiryMs) return { state: "none" };
  if (nowMs >= dueAtMs) return { state: "due", dueAtMs, dueTime: lagosClock(dueAtMs) };
  return { state: "waiting", dueAtMs, minutesLeft: Math.max(1, Math.ceil((dueAtMs - nowMs) / 60_000)), dueTime: lagosClock(dueAtMs) };
}

/** When the repeat is due: the reading's own time plus the wait the rule set asked for. */
export function recheckDueAtMs(takenAtIso: string, afterMinutes: number): number | null {
  const taken = Date.parse(takenAtIso);
  if (!Number.isFinite(taken) || !Number.isFinite(afterMinutes) || afterMinutes <= 0) return null;
  return taken + afterMinutes * 60_000;
}
