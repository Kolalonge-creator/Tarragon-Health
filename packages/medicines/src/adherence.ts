import { addDays, lagosLocalDate, lagosTimeToUtcMs, type LocalDate } from "./lagos";
import { slotCloseMinutes, slotsBetween } from "./schedule";
import { slotState } from "./dose-state";
import type { DoseLog, ScheduleSpec } from "./types";

/**
 * Weekly adherence, one formula (docs/research/S08.md section 2).
 *
 *   due         = scheduled (not as-needed) doses whose time has passed, over
 *                 the last `windowDays` Lagos days including today, that fall
 *                 inside each medicine's active dates and after it was added
 *   taken       = due doses the patient marked taken, on time or late
 *   percent     = round(100 * taken / due), or null when fewer than `minDoses`
 *                 doses were due
 *
 * Skipped counts as not taken (it is a dose that did not happen) but is reported
 * apart from missed, so a clinician sees "skipped because of a side effect"
 * rather than a bare miss. This is a count of doses the patient marked taken,
 * not a clinical proportion of days covered: there is no dispensing data here.
 * The 80 percent line is a display band for the care team, never a patient grade.
 */
export interface AdherenceMedicine {
  id: string;
  spec: ScheduleSpec;
  /** Dose logs keyed by `${date}|${time}` (Lagos) for this medicine. */
  logs: ReadonlyMap<string, readonly DoseLog[]>;
  /** When the medicine was added, UTC ms. Slots due before it are not counted (a medicine added at noon owes no 08:00 dose). */
  activeFromMs: number;
}

export interface AdherenceConfig {
  windowDays: number;
  minDoses: number;
  missedAfterMinutes: number;
  thresholdPercent: number;
}

export interface AdherenceResult {
  /** Null when there are too few due doses to say anything fair. */
  percent: number | null;
  due: number;
  taken: number;
  late: number;
  skipped: number;
  missed: number;
  unavailable: number;
  /** True when a percent exists and sits below the threshold (a signal for the care team, not a grade). */
  belowThreshold: boolean;
  windowStart: LocalDate;
  windowEnd: LocalDate;
}

export function computeWeeklyAdherence(
  medicines: readonly AdherenceMedicine[],
  nowMs: number,
  cfg: AdherenceConfig,
): AdherenceResult {
  const windowEnd = lagosLocalDate(nowMs);
  const windowStart = addDays(windowEnd, -(cfg.windowDays - 1));
  const r = { due: 0, taken: 0, late: 0, skipped: 0, missed: 0, unavailable: 0 };

  for (const med of medicines) {
    for (const slot of slotsBetween(med.spec, windowStart, windowEnd)) {
      const key = `${slot.date}|${slot.time}`;
      const dueAt = lagosTimeToUtcMs(slot.date, slot.time);
      if (dueAt > nowMs || dueAt < med.activeFromMs) continue; // not yet due, or before the medicine was added
      const logs = med.logs.get(key) ?? [];
      const state = slotState(dueAt, logs, nowMs, slotCloseMinutes(med.spec, cfg.missedAfterMinutes));
      // A slot inside its "due" window with no answer yet is still open, not a miss.
      if (state === "due") continue;
      r.due += 1;
      if (state === "taken") r.taken += 1;
      else if (state === "late") r.late += 1;
      else if (state === "skipped") r.skipped += 1;
      else if (state === "unavailable") r.unavailable += 1;
      else r.missed += 1;
    }
  }

  const denominator = r.due;
  const numerator = r.taken + r.late;
  const percent = denominator >= cfg.minDoses ? Math.round((100 * numerator) / denominator) : null;
  return {
    percent,
    due: r.due,
    taken: r.taken,
    late: r.late,
    skipped: r.skipped,
    missed: r.missed,
    unavailable: r.unavailable,
    belowThreshold: percent !== null && percent < cfg.thresholdPercent,
    windowStart,
    windowEnd,
  };
}

/** Group a flat list of logs for one medicine into the per-slot map `computeWeeklyAdherence` reads. */
export function groupLogsBySlot(
  logs: readonly (DoseLog & { date: LocalDate; time: string })[],
): Map<string, DoseLog[]> {
  const map = new Map<string, DoseLog[]>();
  for (const l of logs) {
    const key = `${l.date}|${l.time}`;
    const list = map.get(key);
    const entry: DoseLog = { status: l.status, source: l.source, loggedAtMs: l.loggedAtMs };
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}
