import type { OutboxKind } from "./outbox-rules";

/**
 * Pure rules for the data-cost meter and the "sync on Wi-Fi only" choice (S06z). No I/O, so every
 * branch is unit tested.
 *
 * Two promises sit above everything else here:
 *   1. The cost shown is an ESTIMATE from a configured price per megabyte, in whole kobo, and says so.
 *   2. Wi-Fi only never delays anything urgent. A danger-flagged entry and every kind of entry that can
 *      carry a safety signal are sent at once, on any connection, whatever the choice is.
 */

export const BYTES_PER_MB = 1_000_000;
const MAX_KOBO = Number.MAX_SAFE_INTEGER;

/** What kind of connection the phone is on right now. "unknown" is anything we cannot tell. */
export type ConnectionKind = "wifi" | "cellular" | "other" | "unknown" | "none";

/**
 * Whole kobo for `bytes` of mobile data at `pricePerMbKobo` kobo a megabyte (1 MB = 1,000,000 bytes, the
 * same unit the meter shows). Rounds to the nearest kobo, half up, using exact integer arithmetic so a
 * very large count cannot pick up floating point error. Zero, negative, NaN and infinite inputs give 0;
 * a result too big to hold exactly is capped at the largest safe integer.
 */
export function estimateCostKobo(bytes: number, pricePerMbKobo: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(pricePerMbKobo) || bytes <= 0 || pricePerMbKobo <= 0) return 0;
  const exact = (BigInt(Math.floor(bytes)) * BigInt(Math.floor(pricePerMbKobo)) + BigInt(BYTES_PER_MB / 2)) / BigInt(BYTES_PER_MB);
  return exact > BigInt(MAX_KOBO) ? MAX_KOBO : Number(exact);
}

/**
 * "N12.50", "N1,250", "N0.03" (with the naira sign). Kobo in, naira out, never floating point. Zero reads
 * "N0".
 */
export function formatNaira(kobo: number): string {
  const safe = Number.isFinite(kobo) && kobo > 0 ? Math.min(Math.floor(kobo), MAX_KOBO) : 0;
  const naira = Math.floor(safe / 100);
  const rest = safe % 100;
  const whole = String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === 0 ? `₦${whole}` : `₦${whole}.${String(rest).padStart(2, "0")}`;
}

/**
 * Which kinds of entry may EVER wait for Wi-Fi. This is a safety rule, not a setting, and it is an allow-list on purpose:
 * a kind that is not named here is urgent and always goes straight away, so a new outbox kind added by any other change is safe by
 * default and cannot break this file or quietly start waiting.
 *
 * Only a dose log, a meal log and a WEIGHT reading (see HOLDABLE_VITAL_TYPE) are ever held. A symptom, a patient's answer after a red alert and the
 * pregnancy safety logs (kick counts and contractions, where a change in pattern can be the signal) always go straight away. Every other reading
 * (blood pressure, glucose, pulse, temperature, oxygen) is treated as urgent too: the phone's danger flag is only as good as its
 * classifier (a pulse that is logged with a blood pressure is never flagged, and a classifier error leaves a reading unflagged),
 * and the server's red-flag engine judges all of them. Weight is the one reading with no red-flag rule.
 *
 * A meal written in words carries no red-flag rule on the server, so it may wait like a dose log or a weight (S49a, decided in the S06z merge).
 * Activity logs, anchor times, day shifts and every other kind are not on this list, so they send at once.
 */
const MAY_WAIT_FOR_WIFI: ReadonlySet<OutboxKind> = new Set<OutboxKind>(["dose", "meal"]);

/** The one vital type that is safe to hold: nothing on the server raises an alert for it. */
const HOLDABLE_VITAL_TYPE = "weight";

export interface EntryFacts {
  kind: OutboxKind;
  danger: boolean;
  /** The vital type of a `vital` entry (blood_pressure, glucose, weight, pulse, ...). Unknown is treated as urgent. */
  vitalType?: string | null;
}

/** True when this entry must never wait for Wi-Fi: anything the phone classed urgent or emergency, and every urgent kind. */
export function isUrgentEntry(entry: EntryFacts): boolean {
  if (entry.danger) return true;
  if (entry.kind === "vital") return entry.vitalType !== HOLDABLE_VITAL_TYPE;
  return !MAY_WAIT_FOR_WIFI.has(entry.kind);
}

/**
 * A dose log that arrives after the server has already written "missed" for that dose raises a false miss for the care
 * team. So a held dose log must land before (the server's missed window after the dose was due) less this slack, which
 * covers a background flush that runs late.
 */
export const DOSE_MISSED_SLACK_MS = 60 * 60_000;

export interface HoldInput {
  wifiOnly: boolean;
  connection: ConnectionKind;
  entry: EntryFacts & {
    createdAtMs: number;
    /** When the dose was due (UTC ms), for a scheduled dose log. Null or absent for an as-needed dose. */
    dueMs?: number | null;
  };
  nowMs: number;
  /** The longest an ordinary entry waits for Wi-Fi (config offline.data_cost.max_hold_hours, in ms). */
  maxHoldMs: number;
  /** The server's missed window in ms (medicines config serverMissedAfterMinutes). 0 means unknown: a scheduled dose is then never held. */
  serverMissedMs: number;
  /** The patient tapped "Send now on mobile data". */
  forced?: boolean;
}

/**
 * Whether this entry is held back for Wi-Fi right now. Held only when ALL of: the patient chose Wi-Fi
 * only, the phone is KNOWN to be on mobile data (a connection we cannot identify sends, it never holds),
 * the entry is not urgent, the patient has not asked to send now, and it is still inside its deadline.
 * The deadline is the earlier of the hold cap after it was logged and, for a scheduled dose log, the server's
 * missed window after the dose was due (less a slack), so a held dose log can never turn into a false missed dose.
 */
export function shouldHoldForWifi(input: HoldInput): boolean {
  if (!input.wifiOnly || input.forced === true) return false;
  if (input.connection !== "cellular") return false;
  if (isUrgentEntry(input.entry)) return false;
  const waited = input.nowMs - input.entry.createdAtMs;
  // An entry stamped in the future (a clock that moved) or with an unreadable time is never held.
  if (!Number.isFinite(waited) || waited < 0) return false;
  let deadline = input.entry.createdAtMs + input.maxHoldMs;
  const due = input.entry.dueMs;
  if (typeof due === "number" && Number.isFinite(due)) {
    // Without the server's missed window the dose-late rule cannot be honoured, so a scheduled dose is not held.
    if (!(input.serverMissedMs > 0)) return false;
    deadline = Math.min(deadline, due + input.serverMissedMs - DOSE_MISSED_SLACK_MS);
  }
  return input.nowMs < deadline;
}

/**
 * Whether the background read of the patient's own records waits for Wi-Fi. Reading is never urgent, but the
 * very first read on a phone is not skipped: with nothing yet on the phone a patient would see an empty app.
 */
export function shouldHoldPullForWifi(input: { wifiOnly: boolean; connection: ConnectionKind; hasPulledBefore: boolean }): boolean {
  return input.wifiOnly && input.connection === "cellular" && input.hasPulledBefore;
}

/** The data meter's figures for display. */
export interface UsageFigures {
  /** Bytes the sync code used on mobile data this month, plus any it could not place on a connection. */
  monthBytes: number;
  /** Part of that count that could not be placed on mobile data or Wi-Fi. */
  unplacedBytes: number;
  lastSync: { bytes: number; at: number } | null;
}

export interface CostFigures {
  monthKobo: number;
  lastSyncKobo: number | null;
}

export function costFigures(usage: UsageFigures, pricePerMbKobo: number): CostFigures {
  return {
    monthKobo: estimateCostKobo(usage.monthBytes, pricePerMbKobo),
    lastSyncKobo: usage.lastSync ? estimateCostKobo(usage.lastSync.bytes, pricePerMbKobo) : null,
  };
}
