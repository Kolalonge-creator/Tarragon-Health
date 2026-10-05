import { MINUTE_MS } from "./lagos";
import type { DoseLog, SlotState } from "./types";

/**
 * What is true of one dose slot, from the logs written for it.
 *
 * Dose logs are append-only: a correction is a new row, and the latest one
 * wins. One rule sits on top of that: a `missed` row written by the server
 * (source `system`) never beats a row the patient or their supporter wrote.
 * A dose logged offline at 08:00 and synced at 14:00 therefore stays "taken"
 * even though the server's own "missed" row was written later (S08, INV-12
 * adjacent: the server records silence; it never overrules the patient).
 */
function isServerMissed(log: DoseLog): boolean {
  return log.status === "missed" && log.source === "system";
}

/** The log that decides the slot, or null when nothing has been logged. */
export function effectiveLog(logs: readonly DoseLog[]): DoseLog | null {
  if (logs.length === 0) return null;
  const human = logs.filter((l) => !isServerMissed(l));
  const pool = human.length > 0 ? human : logs;
  let best = pool[0];
  for (const l of pool) {
    if (l.loggedAtMs >= best.loggedAtMs) best = l;
  }
  return best;
}

const FROM_LOG: Record<DoseLog["status"], SlotState> = {
  taken: "taken",
  delayed: "late",
  skipped: "skipped",
  missed: "missed",
  not_available: "unavailable",
};

/**
 * The state to show for a slot. With no log, "upcoming" before it is due, "due"
 * for the missed window, then "missed" (derived from the clock, so it holds even
 * if the phone never delivered a reminder).
 */
export function slotState(dueAtMs: number, logs: readonly DoseLog[], nowMs: number, missedAfterMinutes: number): SlotState {
  const eff = effectiveLog(logs);
  if (eff) return FROM_LOG[eff.status];
  if (nowMs < dueAtMs) return "upcoming";
  if (nowMs < dueAtMs + missedAfterMinutes * MINUTE_MS) return "due";
  return "missed";
}

/** A slot is closed when the patient (or supporter) has answered it. Closed slots get no reminder. */
export function isClosed(state: SlotState): boolean {
  return state === "taken" || state === "late" || state === "skipped" || state === "unavailable";
}

export type TakenTimeRefusal = "in_future" | "outside_window";

export type TakenTimeResult = { ok: true; atMs: number } | { ok: false; reason: TakenTimeRefusal };

/**
 * The time a patient picks for "I took it earlier". It cannot be in the future
 * (beyond a small clock skew) or older than the server keeps device times for
 * (the S06 backdate window); the server enforces the same bounds, this gives the
 * patient the answer before they hit send.
 */
export function resolveTakenTime(
  chosenMs: number,
  nowMs: number,
  windowHours: number,
  skewMinutes: number,
): TakenTimeResult {
  if (chosenMs > nowMs + skewMinutes * MINUTE_MS) return { ok: false, reason: "in_future" };
  if (chosenMs < nowMs - windowHours * 60 * MINUTE_MS) return { ok: false, reason: "outside_window" };
  return { ok: true, atMs: Math.min(chosenMs, nowMs) };
}

/** Status to record for a "taken" tap: on time inside the missed window, otherwise "delayed" (taken late). */
export function takenStatus(dueAtMs: number, takenAtMs: number, missedAfterMinutes: number): "taken" | "delayed" {
  return takenAtMs - dueAtMs > missedAfterMinutes * MINUTE_MS ? "delayed" : "taken";
}

/** True while a dose a patient just logged may still be taken back (the row has not left the phone). */
export function canUndo(loggedAtMs: number, nowMs: number, undoSeconds: number): boolean {
  return nowMs >= loggedAtMs && nowMs - loggedAtMs < undoSeconds * 1000;
}

/** True when a second tap on the same dose arrives too soon after the first to be deliberate. */
export function isDoubleTap(lastTapMs: number | null, nowMs: number, guardMs: number): boolean {
  return lastTapMs !== null && nowMs >= lastTapMs && nowMs - lastTapMs < guardMs;
}
