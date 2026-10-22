/**
 * Record-triggered lessons (S55 quality gates, item 7): "what this reading means", shown on Today and Learn after a blood pressure or
 * glucose reading, or a released lab value, lands in a band a clinician has keyed to a lesson.
 *
 * THIS FILE DECIDES NOTHING CLINICAL. It never holds a threshold. The caller classifies each reading with the platform's own
 * deterministic classifiers (apps/web lib/rules/bp-classification.ts and glucose-classification.ts, mirrored on the phone, and the
 * stored lab flag) and hands over the resulting level. This file only applies the display rules below to those levels.
 *
 * Rules, each pinned by record-lesson.test.ts:
 *  1. The urgent-help box always outranks a lesson. If the latest reading, or any reading inside the suppression window, is red or
 *     emergency (or a lab value is critical), the answer is "urgent" and NO lesson is returned, for any source.
 *  2. Only the lowest band (green, or a normal lab value) may show a lesson from a single reading. Anything above it (amber, or a high or low
 *     lab value) needs a sustained pattern: at least `sustained_readings` amber readings inside `window_days`, or at least
 *     `sustained_results` successive released lab results with the same flag. One high reading on its own never produces a lesson.
 *  3. Labs: only a released result is used (INV-03). A result holding a sensitive-positive item (INV-04) is dropped whole, and a
 *     qualitative positive or negative is never a lesson trigger.
 *  4. The lesson code comes from versioned configuration (`learning.record_lessons`, PROPOSED). No code means no lesson.
 *  5. Whether the lesson may be shown at all is a separate gate (the `record_triggered_lessons_enabled` go-live guard) checked by the
 *     caller before this runs. The database re-checks the guard, the lesson's publication state and the source rows when it logs the show.
 */

export type RecordLevel = "green" | "amber" | "red" | "emergency" | "unknown";
export type RecordLessonSource = "blood_pressure" | "glucose" | "lab";
export type RecordBand = "in_target" | "above_target" | "normal" | "high" | "low";

export interface BandedReading {
  readonly id: string;
  /** ISO timestamp the reading was taken. */
  readonly takenAt: string;
  /** Classified by the platform's own classifier, never here. */
  readonly level: RecordLevel;
}

export type LabFlag = "normal" | "low" | "high" | "critical" | "positive" | "negative";

export interface LabItemInput {
  readonly id: string;
  readonly resultId: string;
  readonly analyteCode: string;
  readonly flag: LabFlag;
  readonly sensitivePositive: boolean;
  readonly releaseState: string;
  /** ISO timestamp the result was received. */
  readonly receivedAt: string;
}

export interface RecordLessonConfig {
  /** Hours after a red or emergency reading during which no lesson is shown. */
  readonly suppress_hours_after_urgent: number;
  readonly vitals: { readonly sustained_readings: number; readonly window_days: number };
  readonly lab: { readonly sustained_results: number };
  readonly lessons: {
    readonly blood_pressure: { readonly in_target?: string; readonly above_target?: string };
    readonly glucose: { readonly in_target?: string; readonly above_target?: string };
    readonly lab: Readonly<Record<string, { readonly normal?: string; readonly high?: string; readonly low?: string }>>;
  };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** Reads the versioned `record_lessons` configuration row from the database into the typed shape, or null when it is malformed (then no lesson is shown). */
export function parseRecordLessonConfig(raw: unknown): RecordLessonConfig | null {
  if (!isRec(raw)) return null;
  const { suppress_hours_after_urgent: suppress, vitals, lab, lessons } = raw;
  if (!posInt(suppress) || !isRec(vitals) || !isRec(lab) || !isRec(lessons)) return null;
  if (!posInt(vitals.sustained_readings) || !posInt(vitals.window_days) || !posInt(lab.sustained_results)) return null;
  const pair = (v: unknown) => (isRec(v) ? { in_target: strOrUndef(v.in_target), above_target: strOrUndef(v.above_target) } : {});
  const labLessons: Record<string, { normal?: string; high?: string; low?: string }> = {};
  if (isRec(lessons.lab)) {
    for (const [analyte, v] of Object.entries(lessons.lab)) {
      if (isRec(v)) labLessons[analyte] = { normal: strOrUndef(v.normal), high: strOrUndef(v.high), low: strOrUndef(v.low) };
    }
  }
  return {
    suppress_hours_after_urgent: suppress,
    vitals: { sustained_readings: vitals.sustained_readings, window_days: vitals.window_days },
    lab: { sustained_results: lab.sustained_results },
    lessons: { blood_pressure: pair(lessons.blood_pressure), glucose: pair(lessons.glucose), lab: labLessons },
  };
}

export interface RecordLessonInput {
  readonly now: string;
  readonly bloodPressure: readonly BandedReading[];
  readonly glucose: readonly BandedReading[];
  readonly labItems: readonly LabItemInput[];
}

export type RecordLessonDecision =
  | { readonly kind: "none"; readonly reason: "no_data" | "not_sustained" | "no_lesson_configured" }
  | { readonly kind: "urgent"; readonly source: RecordLessonSource; readonly sourceId: string }
  | {
      readonly kind: "lesson";
      readonly source: RecordLessonSource;
      readonly band: RecordBand;
      readonly lessonCode: string;
      readonly sourceIds: readonly string[];
      readonly analyteCode?: string;
    };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A reading the platform's classifier calls "green" is not always "in a good range": a very low blood pressure classifies as green, and the
 * single-reading glucose classifier cannot tell "in range" from "high but not yet an alert". These two mappers turn such a green into "unknown"
 * (no lesson) so a lesson never reassures about a reading it should not.
 * The low blood pressure floor is PROPOSED (90/60) and awaits the CMO; until confirmed it only ever makes the lesson more conservative. It mirrors
 * the floor in public.record_lesson_shown. Glucose has no database classifier at all, so the database refuses every glucose lesson and this
 * mapper never offers one as in range.
 */
export const LOW_BP_FLOOR = { systolic: 90, diastolic: 60 } as const;

export function bpLessonLevel(level: RecordLevel, systolic: number | null | undefined, diastolic: number | null | undefined): RecordLevel {
  if (level !== "green") return level;
  if (systolic == null || diastolic == null) return "unknown";
  return systolic < LOW_BP_FLOOR.systolic || diastolic < LOW_BP_FLOOR.diastolic ? "unknown" : "green";
}

/** Glucose is never "in range" for a lesson: only the urgent bands carry through (so urgent help still wins); everything else is unknown. */
export function glucoseLessonLevel(level: RecordLevel): RecordLevel {
  return level === "red" || level === "emergency" ? level : "unknown";
}

const isUrgent = (l: RecordLevel) => l === "red" || l === "emergency";
const byTimeDesc = <T extends { takenAt: string }>(a: T, b: T) => Date.parse(b.takenAt) - Date.parse(a.takenAt);

interface Candidate {
  readonly at: number;
  readonly decision: Extract<RecordLessonDecision, { kind: "lesson" }>;
}

function vitalsDecision(
  source: "blood_pressure" | "glucose",
  readings: readonly BandedReading[],
  config: RecordLessonConfig,
  nowMs: number,
): { urgent: Extract<RecordLessonDecision, { kind: "urgent" }> | null; candidate: Candidate | null; sustainedMiss: boolean; unconfigured: boolean } {
  const known = [...readings].filter((r) => r.level !== "unknown" && Number.isFinite(Date.parse(r.takenAt))).sort(byTimeDesc);
  const none = { urgent: null, candidate: null, sustainedMiss: false, unconfigured: false };
  const latest = known[0];
  if (!latest) return none;

  const suppressFrom = nowMs - config.suppress_hours_after_urgent * HOUR_MS;
  // Urgent help is bounded by the suppression window: a red reading older than the window no longer shows the urgent box, but it still blocks
  // a lesson (the latest reading is not in a good range, so nothing reassuring is shown).
  const urgentHit = known.find((r) => isUrgent(r.level) && Date.parse(r.takenAt) >= suppressFrom);
  if (urgentHit) return { ...none, urgent: { kind: "urgent", source, sourceId: urgentHit.id } };
  if (isUrgent(latest.level)) return { ...none, sustainedMiss: true };

  const codes = config.lessons[source];
  if (latest.level === "green") {
    const code = codes.in_target;
    if (!code) return { ...none, unconfigured: true };
    return {
      ...none,
      candidate: { at: Date.parse(latest.takenAt), decision: { kind: "lesson", source, band: "in_target", lessonCode: code, sourceIds: [latest.id] } },
    };
  }

  // amber: never from one reading
  const windowFrom = nowMs - config.vitals.window_days * DAY_MS;
  const inBand = known.filter((r) => r.level === "amber" && Date.parse(r.takenAt) >= windowFrom);
  if (inBand.length < config.vitals.sustained_readings) return { ...none, sustainedMiss: true };
  const code = codes.above_target;
  if (!code) return { ...none, unconfigured: true };
  return {
    ...none,
    candidate: {
      at: Date.parse(latest.takenAt),
      decision: { kind: "lesson", source, band: "above_target", lessonCode: code, sourceIds: inBand.slice(0, config.vitals.sustained_readings).map((r) => r.id) },
    },
  };
}

function labDecisions(
  items: readonly LabItemInput[],
  config: RecordLessonConfig,
  nowMs: number,
): { urgent: Extract<RecordLessonDecision, { kind: "urgent" }> | null; candidates: Candidate[]; sustainedMiss: boolean; unconfigured: boolean } {
  const out = { urgent: null as Extract<RecordLessonDecision, { kind: "urgent" }> | null, candidates: [] as Candidate[], sustainedMiss: false, unconfigured: false };
  // Rule 3: released only; drop a result whole if any of its items is a sensitive positive.
  const sensitiveResults = new Set(items.filter((i) => i.sensitivePositive).map((i) => i.resultId));
  const usable = items.filter(
    (i) => i.releaseState === "released" && !sensitiveResults.has(i.resultId) && !i.sensitivePositive && i.flag !== "positive" && i.flag !== "negative",
  );

  const critical = usable.filter((i) => i.flag === "critical").sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0];
  // Bounded by the suppression window, like the vitals. An older critical value no longer shows the urgent box, but the analyte below still
  // shows no lesson while its latest value is critical.
  if (critical && Date.parse(critical.receivedAt) >= nowMs - config.suppress_hours_after_urgent * HOUR_MS) {
    out.urgent = { kind: "urgent", source: "lab", sourceId: critical.id };
  }

  const byAnalyte = new Map<string, LabItemInput[]>();
  for (const i of usable) byAnalyte.set(i.analyteCode, [...(byAnalyte.get(i.analyteCode) ?? []), i]);

  for (const [analyte, list] of byAnalyte) {
    const codes = config.lessons.lab[analyte];
    if (!codes) continue;
    const sorted = [...list].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const latest = sorted[0];
    if (!latest || latest.flag === "critical") continue;
    if (latest.flag === "normal") {
      if (!codes.normal) { out.unconfigured = true; continue; }
      out.candidates.push({
        at: Date.parse(latest.receivedAt),
        decision: { kind: "lesson", source: "lab", band: "normal", lessonCode: codes.normal, sourceIds: [latest.id], analyteCode: analyte },
      });
      continue;
    }
    // high or low: never from one result
    const run = sorted.slice(0, config.lab.sustained_results);
    if (run.length < config.lab.sustained_results || !run.every((r) => r.flag === latest.flag)) { out.sustainedMiss = true; continue; }
    const band: RecordBand = latest.flag === "high" ? "high" : "low";
    const code = band === "high" ? codes.high : codes.low;
    if (!code) { out.unconfigured = true; continue; }
    out.candidates.push({
      at: Date.parse(latest.receivedAt),
      decision: { kind: "lesson", source: "lab", band, lessonCode: code, sourceIds: run.map((r) => r.id), analyteCode: analyte },
    });
  }
  return out;
}

export function selectRecordLesson(input: RecordLessonInput, config: RecordLessonConfig): RecordLessonDecision {
  const nowMs = Date.parse(input.now);
  const bp = vitalsDecision("blood_pressure", input.bloodPressure, config, nowMs);
  const gl = vitalsDecision("glucose", input.glucose, config, nowMs);
  const lab = labDecisions(input.labItems, config, nowMs);

  // Rule 1: urgent outranks everything, for every source.
  const urgent = bp.urgent ?? gl.urgent ?? lab.urgent;
  if (urgent) return urgent;

  const candidates: Candidate[] = [bp.candidate, gl.candidate, ...lab.candidates].filter((c): c is Candidate => c !== null);
  const best = candidates.sort((a, b) => b.at - a.at)[0];
  if (best) return best.decision;

  if (bp.unconfigured || gl.unconfigured || lab.unconfigured) return { kind: "none", reason: "no_lesson_configured" };
  if (bp.sustainedMiss || gl.sustainedMiss || lab.sustainedMiss) return { kind: "none", reason: "not_sustained" };
  return { kind: "none", reason: "no_data" };
}
