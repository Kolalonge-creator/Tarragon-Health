/**
 * The guided home blood pressure session (docs/design/BP-home-guided-session.md): what to do next, right now, inside one morning or evening
 * session of the seven-day home check (S07x). Pure and deterministic (INV-01): `nowMs` is an input, there is no clock, no network, no model.
 *
 * It grades nothing and says nothing about a reading. It only counts the readings already saved in this session and says which step is next:
 *   outside_window  neither the morning nor the evening window is open
 *   rest            no reading yet: rest first (the rest length is configuration)
 *   wait            a reading was just saved: wait out the minimum gap before the next
 *   next            the gap has passed: take reading n of N
 *   done            the session holds all its readings: here is their mean
 *
 * Every number comes from the same versioned configuration as `assessHomeCheck` (`bp.home_programme`, mirrored by the signed database row
 * `home_bp_programme_signoffs`). The caller passes only cuff or manual readings (a wearable estimate is never part of a session; see
 * `diagnosticBpReadings` in @tarragon/shared). The saving itself stays in the one existing blood pressure form, so every safety path (on-device
 * triage, emergency guidance, the outbox) is exactly what it always was.
 */
import { lagosDateKey } from "./dates";
import { dedupeReadings, lagosHourOf, sessionPartOf, type HomeBpConfig, type HomeBpReading, type SessionPart } from "./home-bp";

export type SessionStep =
  | { readonly kind: "outside_window"; readonly next: SessionPart }
  | { readonly kind: "rest"; readonly part: SessionPart; readonly number: number; readonly of: number; readonly restMinutes: number }
  | { readonly kind: "wait"; readonly part: SessionPart; readonly number: number; readonly of: number; readonly secondsLeft: number }
  | { readonly kind: "next"; readonly part: SessionPart; readonly number: number; readonly of: number }
  | { readonly kind: "done"; readonly part: SessionPart; readonly readings: number; readonly mean: { readonly systolic: number; readonly diastolic: number } };

export interface SessionInput {
  /** Cuff or manual readings only, any order, any day; the session picks out today's readings in the open window. */
  readonly readings: readonly HomeBpReading[];
  readonly nowMs: number;
}

const meanOf = (values: readonly number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** Which window the next session belongs to when none is open: morning before it opens, evening between the two, morning again after both. */
function nextWindow(nowMs: number, cfg: HomeBpConfig): SessionPart {
  const h = lagosHourOf(nowMs);
  if (h < cfg.protocol.morningHours[0]) return "morning";
  if (h < cfg.protocol.eveningHours[0]) return "evening";
  return "morning";
}

export function planSession(input: SessionInput, cfg: HomeBpConfig): SessionStep {
  const part = sessionPartOf(input.nowMs, cfg);
  if (part === null) return { kind: "outside_window", next: nextWindow(input.nowMs, cfg) };

  const today = lagosDateKey(input.nowMs);
  const inSession = dedupeReadings(input.readings, cfg).filter((r) => lagosDateKey(r.atMs) === today && sessionPartOf(r.atMs, cfg) === part);
  const per = cfg.protocol.readingsPerSession;
  const n = inSession.length;

  if (n >= per) {
    return {
      kind: "done",
      part,
      readings: n,
      mean: { systolic: meanOf(inSession.map((r) => r.systolic)), diastolic: meanOf(inSession.map((r) => r.diastolic)) },
    };
  }
  if (n === 0) return { kind: "rest", part, number: 1, of: per, restMinutes: cfg.protocol.restMinutes };

  const gapMs = cfg.protocol.minGapMinutes * 60_000;
  const lastAt = Math.max(...inSession.map((r) => r.atMs));
  const elapsed = input.nowMs - lastAt;
  if (elapsed < gapMs) {
    // A phone clock set in the past can put the last reading "in the future"; never ask anyone to wait longer than the gap.
    return { kind: "wait", part, number: n + 1, of: per, secondsLeft: Math.min(Math.ceil((gapMs - elapsed) / 1000), gapMs / 1000) };
  }
  return { kind: "next", part, number: n + 1, of: per };
}
