/**
 * W-25: how well a blood pressure reading followed the measuring routine, and which target a reading is judged against. Pure, deterministic, no clock, network or model.
 *
 * The grade (A, B or C) is for the care team and for outcome analysis only. It is NEVER shown to the patient as a mark or a score (a patient who sees "C" stops logging),
 * never in a notification, and never changes a medicine or a red-flag decision. A low grade means "less certain", not "wrong".
 *
 *   C                  implausible, or a recorded position that is not seated
 *   unknown            plausible, but the position was never recorded (not the same as "not seated")
 *   rest_not_recorded  plausible and seated, but rest minutes are not known (true of every stored reading today: rest is not stored anywhere)
 *   A                  seated, rested for the configured minutes, and at least one repeat reading in the same sitting
 *   B                  seated, rest known, but too short or no repeat reading
 *
 * Every number comes from the versioned configuration `bp.target_config` (mirrored by the database row `bp_target_config`). The numbers are PROPOSED and the row is UNSIGNED
 * (founder decision D-09): nothing here may be described as signed or validated. The same rule is written in SQL (`private.bp_reading_grade`); the proof script runs one
 * table of cases through both.
 *
 * A wearable or cuffless estimate never reaches this function's callers: the database view that feeds statistics drops them (see `isEstimateBpSource` in @tarragon/shared).
 */

export type ReadingGrade = "A" | "B" | "C" | "unknown" | "rest_not_recorded";

/** Where a reading was measured. `clinic` comes from the care team's clinic table; `unlabelled` means nobody said. */
export type MeasurementContext = "home_self" | "home_assisted" | "pharmacy" | "diary" | "clinic" | "unlabelled";

export type TargetKind = "home" | "clinic";

export interface BpTargetPair {
  readonly systolic: number;
  readonly diastolic: number;
}

export interface ReadingGradeConfig {
  readonly restMinutes: number;
  /** A repeat reading is another reading this many minutes (inclusive) or fewer away from this one, and at least `minGapMinutes` away. */
  readonly repeatWindowMinutes: number;
  readonly minGapMinutes: number;
  readonly plausible: { readonly systolicMin: number; readonly systolicMax: number; readonly diastolicMin: number; readonly diastolicMax: number };
  readonly minReadingsPerPerson: number;
}

export interface BpTargetConfig {
  readonly version: number;
  /** True only when the Chief Medical Officer (and the external clinician) have signed this version. An unsigned config must never be shown as a signed target. */
  readonly signed: boolean;
  readonly targets: { readonly home: BpTargetPair; readonly clinic: BpTargetPair };
  readonly contextToTarget: Readonly<Record<string, TargetKind>>;
  readonly grade: ReadingGradeConfig;
}

export interface ReadingGradeInput {
  readonly systolic: number;
  readonly diastolic: number;
  /** `seated`, `standing`, `lying`, or nothing recorded. */
  readonly position: string | null | undefined;
  /** Whole or part minutes of rest recorded before the reading; null / undefined when rest was not recorded. */
  readonly restedMinutes: number | null | undefined;
  /** How many OTHER readings sit inside the repeat window of this one (see `countRepeatReadings`). */
  readonly repeatCount: number;
}

export function isPlausibleBp(systolic: number, diastolic: number, cfg: ReadingGradeConfig): boolean {
  const p = cfg.plausible;
  return (
    Number.isFinite(systolic) && Number.isFinite(diastolic) &&
    systolic >= p.systolicMin && systolic <= p.systolicMax &&
    diastolic >= p.diastolicMin && diastolic <= p.diastolicMax &&
    systolic > diastolic
  );
}

export function gradeBpReading(input: ReadingGradeInput, cfg: ReadingGradeConfig): ReadingGrade {
  if (!isPlausibleBp(input.systolic, input.diastolic, cfg)) return "C";
  // a position nobody recorded is "unknown", not "not seated"
  if (input.position === null || input.position === undefined) return "unknown";
  if (input.position !== "seated") return "C";
  // without a recorded rest we cannot say A or B
  if (typeof input.restedMinutes !== "number") return "rest_not_recorded";
  if (input.restedMinutes >= cfg.restMinutes && input.repeatCount >= 1) return "A";
  return "B";
}

/** Number of other readings (given as epoch milliseconds) that count as a repeat of the reading taken at `takenAtMs`. */
export function countRepeatReadings(takenAtMs: number, othersMs: readonly number[], cfg: ReadingGradeConfig): number {
  const lo = cfg.minGapMinutes * 60_000;
  const hi = cfg.repeatWindowMinutes * 60_000;
  let n = 0;
  for (const o of othersMs) {
    const gap = Math.abs(o - takenAtMs);
    if (o !== takenAtMs && gap >= lo && gap <= hi) n += 1;
  }
  return n;
}

/**
 * Which target a reading in this context is judged against. Home, diary and assisted-home readings use the home target; pharmacy and clinic readings use the clinic target.
 * An unlabelled reading (or an unknown context) returns null: it is counted but never judged, so a home average is never quietly held to the clinic line (or the reverse).
 */
export function targetKindForContext(context: string, cfg: BpTargetConfig): TargetKind | null {
  return cfg.contextToTarget[context] ?? null;
}

export function targetFor(context: string, cfg: BpTargetConfig): BpTargetPair | null {
  const kind = targetKindForContext(context, cfg);
  return kind ? cfg.targets[kind] : null;
}

/**
 * Control against a target, the same strict "under both numbers" rule the outcome reports use (S75). Returns null when no target applies to the context, or when the
 * config is not signed: an unsigned target gives no control figure.
 */
export function isUnderTarget(meanSystolic: number, meanDiastolic: number, context: string, cfg: BpTargetConfig): boolean | null {
  if (!cfg.signed) return null;
  const t = targetFor(context, cfg);
  return t ? meanSystolic < t.systolic && meanDiastolic < t.diastolic : null;
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`bp target config: ${path} must be a number`);
  return v;
}

function pair(v: unknown, path: string): BpTargetPair {
  const o = (v ?? {}) as Record<string, unknown>;
  return { systolic: num(o.systolic, `${path}.systolic`), diastolic: num(o.diastolic, `${path}.diastolic`) };
}

/** Reads the `config` jsonb of a `bp_target_config` row (or the registry value). `signed` comes from the row, never from the jsonb. Throws on a missing number. */
export function parseBpTargetConfig(version: number, signed: boolean, value: unknown): BpTargetConfig {
  const v = (value ?? {}) as Record<string, unknown>;
  const targets = (v.targets ?? {}) as Record<string, unknown>;
  const grade = (v.grade ?? {}) as Record<string, unknown>;
  const pl = (grade.plausible ?? {}) as Record<string, unknown>;
  const map = (v.contextToTarget ?? {}) as Record<string, unknown>;
  const contextToTarget: Record<string, TargetKind> = {};
  for (const [k, kind] of Object.entries(map)) {
    if (kind !== "home" && kind !== "clinic") throw new Error(`bp target config: contextToTarget.${k} must be home or clinic`);
    contextToTarget[k] = kind;
  }
  return {
    version,
    signed,
    targets: { home: pair(targets.home, "targets.home"), clinic: pair(targets.clinic, "targets.clinic") },
    contextToTarget,
    grade: {
      restMinutes: num(grade.restMinutes, "grade.restMinutes"),
      repeatWindowMinutes: num(grade.repeatWindowMinutes, "grade.repeatWindowMinutes"),
      minGapMinutes: num(grade.minGapMinutes, "grade.minGapMinutes"),
      plausible: {
        systolicMin: num(pl.systolicMin, "grade.plausible.systolicMin"),
        systolicMax: num(pl.systolicMax, "grade.plausible.systolicMax"),
        diastolicMin: num(pl.diastolicMin, "grade.plausible.diastolicMin"),
        diastolicMax: num(pl.diastolicMax, "grade.plausible.diastolicMax"),
      },
      minReadingsPerPerson: num(grade.minReadingsPerPerson, "grade.minReadingsPerPerson"),
    },
  };
}
