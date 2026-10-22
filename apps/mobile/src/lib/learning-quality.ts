import {
  parseRecordLessonConfig,
  selectRecordLesson,
  type BandedReading,
  type LabFlag,
  type LabItemInput,
  type RecordLevel,
} from "@tarragon/shared";
import { supabase } from "./supabase";
import { classifyBpLevel } from "./bp-classification";
import { classifyGlucoseOffline } from "./glucose-red-flags";

/**
 * Learning quality gates and record-triggered lessons on the phone: the reviewed glossary, the private teach-back, and the
 * "what this reading means" lesson. Same rules as the web (packages/shared learning/*): the phone only classifies each reading with the
 * platform's own bundled classifiers and hands the levels to the shared selector; the database re-checks and logs.
 */
export interface GlossaryEntry {
  term: string;
  definition: string;
  aliases: string[];
}

export async function loadGlossary(): Promise<GlossaryEntry[]> {
  const { data, error } = await supabase.rpc("learning_glossary");
  if (error) throw error;
  return (data ?? []).map((g) => ({ term: g.term, definition: g.definition, aliases: g.aliases ?? [] }));
}

export interface TeachbackQuestionPublic {
  question: string;
  options: string[];
}
export interface TeachbackMarks {
  total: number;
  correct: number;
  marks: { correct: boolean; correct_index: number; explanation: string }[];
}

export async function loadTeachback(code: string): Promise<TeachbackQuestionPublic[] | null> {
  const { data, error } = await supabase.rpc("lesson_teachback", { p_code: code });
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return null;
  const out: TeachbackQuestionPublic[] = [];
  for (const q of data as unknown[]) {
    if (typeof q !== "object" || q === null) return null;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== "string" || !Array.isArray(r.options) || !r.options.every((o) => typeof o === "string")) return null;
    out.push({ question: r.question, options: r.options as string[] });
  }
  return out;
}

export async function recordTeachback(code: string, picks: number[]): Promise<TeachbackMarks> {
  const { data, error } = await supabase.rpc("record_teachback_result", { p_code: code, p_picks: picks });
  if (error) throw error;
  const r = data as Record<string, unknown> | null;
  if (!r || typeof r.total !== "number" || typeof r.correct !== "number" || !Array.isArray(r.marks)) throw new Error("teachback result not available");
  return { total: r.total, correct: r.correct, marks: r.marks as TeachbackMarks["marks"] };
}

export async function shareTeachback(code: string, share: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("share_teachback_with_care_team", { p_code: code, p_share: share });
  if (error) throw error;
  return data === true;
}

/** Glucose level for one reading from the phone's bundled single-reading classifier (the same mapping the web uses for its tile). */
export function glucoseLevel(mmol: number | null | undefined): RecordLevel {
  if (mmol == null) return "unknown";
  switch (classifyGlucoseOffline(mmol, null).tier) {
    case "emergency":
      return "emergency";
    case "urgent":
      return "red";
    case "amber":
      return "amber";
    default:
      return "green";
  }
}

export type RecordLessonState =
  | { kind: "off" }
  | { kind: "none" }
  | { kind: "urgent" }
  | { kind: "lesson"; code: string; title: string; body: string };

const DAY_MS = 86_400_000;
export const RECORD_GUARD = "record_triggered_lessons_enabled";

export async function loadRecordLesson(patientId: string): Promise<RecordLessonState> {
  const open = await supabase.rpc("go_live_guard_is_open", { p_key: RECORD_GUARD });
  if (open.error || open.data !== true) return { kind: "off" };

  const cfgRow = await supabase.from("learning_config").select("value").eq("key", "record_lessons").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const config = parseRecordLessonConfig(cfgRow.data?.value);
  if (!config) return { kind: "none" };

  const sinceIso = new Date(Date.now() - Math.max(config.vitals.window_days, config.suppress_hours_after_urgent / 24) * DAY_MS).toISOString();
  const vitals = await supabase
    .from("vitals_readings")
    .select("id, vital_type, systolic, diastolic, glucose_mmol_l, taken_at")
    .eq("patient_id", patientId)
    .is("correction_status", null)
    .gte("taken_at", sinceIso)
    .order("taken_at", { ascending: false })
    .limit(60);
  if (vitals.error) return { kind: "none" };
  const bloodPressure: BandedReading[] = [];
  const glucose: BandedReading[] = [];
  for (const v of vitals.data ?? []) {
    if (v.vital_type === "blood_pressure") bloodPressure.push({ id: v.id, takenAt: v.taken_at, level: classifyBpLevel(v.systolic, v.diastolic) });
    else if (v.vital_type === "glucose") glucose.push({ id: v.id, takenAt: v.taken_at, level: glucoseLevel(v.glucose_mmol_l) });
  }

  const labRes = await supabase.rpc("record_lesson_lab_items");
  const labItems: LabItemInput[] = (labRes.error ? [] : (labRes.data ?? [])).map((i) => ({
    id: i.id,
    resultId: i.result_id,
    analyteCode: i.analyte_code,
    flag: i.flag as LabFlag,
    sensitivePositive: i.sensitive_positive,
    releaseState: i.release_state,
    receivedAt: i.received_at,
  }));

  const decision = selectRecordLesson({ now: new Date().toISOString(), bloodPressure, glucose, labItems }, config);
  if (decision.kind === "urgent") return { kind: "urgent" };
  if (decision.kind !== "lesson") return { kind: "none" };

  const logged = await supabase.rpc("record_lesson_shown", {
    p_source: decision.source,
    p_band: decision.band,
    p_lesson_code: decision.lessonCode,
    p_source_ids: [...decision.sourceIds],
  });
  if (logged.error || (logged.data !== "shown" && logged.data !== "already_shown")) return { kind: "none" };

  const detail = await supabase.rpc("health_education_content_detail", { p_code: decision.lessonCode });
  const lesson = detail.data?.[0];
  if (detail.error || !lesson || !lesson.body) return { kind: "none" };
  return { kind: "lesson", code: lesson.code, title: lesson.title, body: lesson.body };
}
