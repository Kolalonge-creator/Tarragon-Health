import type { AnchoredDose, AnchorProfile } from "./anchors";
import type { LocalDate } from "./lagos";

export type FoodNote = "with_food" | "before_food" | "after_food" | "empty_stomach" | "bedtime";

export interface ScheduleCommon {
  /** First day the medicine is taken. Null means "already started". Required for a taper. */
  startDate: LocalDate | null;
  /** Last day, inclusive. Null means ongoing. */
  endDate: LocalDate | null;
  foodNote: FoodNote | null;
  /**
   * A flexible window: the dose is on time from its clock time until this many minutes
   * later (0 or absent means the exact time). The reminder fires at the start and, for a
   * window long enough, once more at the middle.
   */
  windowMinutes?: number;
  /**
   * Doses tied to a daily anchor (waking, a meal, a prayer, bedtime) instead of a clock time (S08z). Only daily, every-N-days and
   * weekday schedules carry them. They sit alongside `times`, which may then be empty.
   */
  anchored?: AnchoredDose[];
  /**
   * RUNTIME ONLY, never stored: the patient's anchor times and day shifts, attached by the caller so every reader of the spec
   * resolves anchored doses the same way. Strip it with `toStoredSpec` before saving.
   */
  anchorProfile?: AnchorProfile;
}

export interface TaperStep {
  /** How many consecutive days this step lasts. */
  days: number;
  times: string[];
  /** What to take at each time in this step, shown to the patient (for example "half a tablet"). */
  doseText: string;
}

export type ScheduleSpec = ScheduleCommon &
  (
    | { kind: "daily"; times: string[] }
    | { kind: "every_n_days"; times: string[]; intervalDays: number; anchorDate: LocalDate }
    | { kind: "weekdays"; times: string[]; days: number[] }
    | { kind: "taper"; steps: TaperStep[] }
    | { kind: "as_needed"; maxPerDay: number | null }
  );

export interface Slot {
  date: LocalDate;
  /** "HH:MM", Africa/Lagos wall clock. */
  time: string;
  /** Set only by a taper step. */
  doseText: string | null;
  /** Set only on a slot that came from an anchored dose (S08z): which anchor and offset it was resolved from, so it can be shown in plain words. */
  anchored?: AnchoredDose;
}

export type LogStatus = "taken" | "delayed" | "skipped" | "missed" | "not_available";
export type LogSource = "patient" | "clinician" | "device" | "partner" | "system" | "ussd";

export interface DoseLog {
  status: LogStatus;
  source: LogSource | null;
  /** When the dose happened (the bounded device time the server keeps), UTC ms. */
  loggedAtMs: number;
}

export type SlotState = "upcoming" | "due" | "taken" | "late" | "skipped" | "missed" | "unavailable";
