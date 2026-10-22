/**
 * The guided home blood pressure measurement, around the S07x programme (S70b item 5). The programme already exists (docs/design/S07x.md,
 * docs/design/BP-home-guided-session.md): two readings a minute apart in a morning and an evening session over seven days, a deterministic average once
 * there are enough readings, a task for the care team. This file adds only the three missing pieces, all PURE and all reading the SAME signed
 * configuration (`HomeBpConfig`), so a change the CMO signs changes them with no code change and no number lives here:
 *
 *   1. preMeasureChecklist   what to do before the first reading (seated, rested, arm at heart level, cuff size, nothing in the last half hour)
 *   2. sessionTracker        the seven-day grid: each morning and evening session done, still to do, or missed
 *   3. buildHomeBpClinicianSummary   the one-page summary for the care team: average, range, count, completeness
 *
 * Nothing here saves a reading, grades one or calls a model. Averaging is `assessHomeCheck` (the live rule); a reading goes through the same
 * triage as any manual one because it is typed into the same form. The clinician summary is rendered only from rows the audited clinician read returned.
 */
import {
  addLocalDays,
  assessHomeCheck,
  dedupeReadings,
  lagosHourOf,
  pairSessions,
  type HomeBand,
  type HomeBpConfig,
  type HomeBpReading,
  type SessionPart,
} from "./home-bp";
import { lagosDateKey } from "./dates";

/** One line of the pre-measure checklist. `key` is a @tarragon/i18n message key; `params` are filled from the signed configuration. */
export interface ChecklistItem {
  readonly id: "seated" | "rested" | "arm" | "cuff" | "avoid";
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

export function preMeasureChecklist(cfg: HomeBpConfig): ChecklistItem[] {
  return [
    { id: "seated", key: "hbp.prep.seated", params: {} },
    { id: "rested", key: "hbp.prep.rested", params: { minutes: cfg.protocol.restMinutes } },
    { id: "arm", key: "hbp.prep.arm", params: {} },
    { id: "cuff", key: "hbp.prep.cuff", params: {} },
    { id: "avoid", key: "hbp.prep.avoid", params: { minutes: cfg.protocol.avoidBeforeMinutes } },
  ];
}

export type TrackerState = "done" | "todo" | "missed";

export interface TrackerCell {
  readonly date: string;
  readonly part: SessionPart;
  readonly state: TrackerState;
  readonly readings: number;
}

/**
 * The seven-day grid. A session is "done" when it holds the configured number of readings, "missed" when its window has closed without that, and
 * "todo" while it is still possible (today before the window closes, or a later day). A reading outside both windows fills no session, as in the
 * programme's own rule.
 */
export function sessionTracker(readings: readonly HomeBpReading[], startDate: string, nowMs: number, cfg: HomeBpConfig): TrackerCell[] {
  const windowEnd = addLocalDays(startDate, cfg.protocol.targetDays - 1);
  const inWindow = readings.filter((r) => {
    const d = lagosDateKey(r.atMs);
    return d >= startDate && d <= windowEnd;
  });
  const sessions = pairSessions(dedupeReadings(inWindow, cfg), startDate, cfg);
  const today = lagosDateKey(nowMs);
  const hour = lagosHourOf(nowMs);
  return sessions.map((s) => {
    if (s.done) return { date: s.date, part: s.part, state: "done" as const, readings: s.readings };
    const closes = s.part === "morning" ? cfg.protocol.morningHours[1] : cfg.protocol.eveningHours[1];
    const over = s.date < today || (s.date === today && hour >= closes);
    return { date: s.date, part: s.part, state: over ? ("missed" as const) : ("todo" as const), readings: s.readings };
  });
}

export interface HomeBpClinicianSummary {
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Counted readings (two readings a minute apart count once each; a repeat inside the minimum gap does not count). */
  readonly readings: number;
  readonly minReadings: number;
  readonly days: number;
  readonly minDays: number;
  readonly sessionsDone: number;
  readonly sessionsExpected: number;
  /** True at the configured minimum readings over the minimum days. */
  readonly complete: boolean;
  /** The average of every counted reading, only when complete (below that there is no average at all, as in the programme). */
  readonly average: { readonly systolic: number; readonly diastolic: number } | null;
  /** Lowest and highest counted reading. Shown even when incomplete: it describes what was measured, not a verdict. */
  readonly range: {
    readonly systolic: { readonly min: number; readonly max: number };
    readonly diastolic: { readonly min: number; readonly max: number };
  } | null;
  /** The band from the signed configuration for the average, or null. */
  readonly band: HomeBand | null;
  readonly configVersion: number;
}

/**
 * The one-page summary for the care team. `readings` must be the rows the AUDITED clinician read returned (manual and device blood pressure only; the
 * caller drops wearable estimates, which are never counted). Counting, the average and the completeness test are `assessHomeCheck`, so this cannot
 * disagree with the patient's own card or the server's recount; the range is added from the same counted readings.
 */
export function buildHomeBpClinicianSummary(readings: readonly HomeBpReading[], startDate: string, nowMs: number, cfg: HomeBpConfig): HomeBpClinicianSummary {
  const a = assessHomeCheck({ readings, startDate, nowMs }, cfg);
  const windowEnd = a.windowEnd;
  const counted = dedupeReadings(
    readings.filter((r) => {
      const d = lagosDateKey(r.atMs);
      return d >= startDate && d <= windowEnd;
    }),
    cfg,
  );
  const range =
    counted.length === 0
      ? null
      : {
          systolic: { min: Math.min(...counted.map((r) => r.systolic)), max: Math.max(...counted.map((r) => r.systolic)) },
          diastolic: { min: Math.min(...counted.map((r) => r.diastolic)), max: Math.max(...counted.map((r) => r.diastolic)) },
        };
  return {
    windowStart: a.windowStart,
    windowEnd,
    readings: a.readings,
    minReadings: cfg.protocol.minReadings,
    days: a.days,
    minDays: cfg.protocol.minDays,
    sessionsDone: a.sessionsDone,
    sessionsExpected: a.sessionsExpected,
    complete: a.complete,
    average: a.mean,
    range,
    band: a.band,
    configVersion: cfg.version,
  };
}
