import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";
import {
  parseRecordLessonConfig,
  selectRecordLesson,
  bpLessonLevel,
  glucoseLessonLevel,
  type BandedReading,
  type LabFlag,
  type LabItemInput,
  type RecordLessonDecision,
} from "@tarragon/shared";
import { classifyBpLevel } from "@/lib/rules/bp-classification";
import { classifyLatestGlucoseLevel } from "@/lib/rules/glucose-classification";

/**
 * Learning quality gates (glossary, teach-back) and record-triggered lessons.
 * Every call is an RLS-scoped read or a SECURITY DEFINER function; nothing here decides what may be shown beyond applying the
 * display rules in packages/shared learning/record-lesson.ts to levels that the platform's own classifiers produced.
 */
type Fn = Database["public"]["Functions"];
export type GlossaryEntry = Fn["learning_glossary"]["Returns"][number];

export const GLOSSARY_KEY = ["learning-glossary"] as const;

/** Reviewed, in-date glossary terms. An unreviewed term never reaches the client (the database function returns published terms only). */
export function useLearningGlossary() {
  return useQuery({
    queryKey: GLOSSARY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("learning_glossary");
      if (error) throw error;
      return (data ?? []) as GlossaryEntry[];
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Teach-back
// ---------------------------------------------------------------------------
export interface PublicTeachbackQuestion {
  readonly question: string;
  readonly options: readonly string[];
}
export interface TeachbackMarks {
  readonly total: number;
  readonly correct: number;
  readonly marks: readonly { readonly correct: boolean; readonly correct_index: number; readonly explanation: string }[];
}

function parsePublicTeachback(raw: unknown): PublicTeachbackQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PublicTeachbackQuestion[] = [];
  for (const q of raw as unknown[]) {
    if (typeof q !== "object" || q === null) return null;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== "string" || !Array.isArray(r.options) || !r.options.every((o) => typeof o === "string")) return null;
    out.push({ question: r.question, options: r.options as string[] });
  }
  return out;
}

export function useLessonTeachback(code: string) {
  return useQuery({
    queryKey: ["learning-teachback", code] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lesson_teachback", { p_code: code });
      if (error) throw error;
      return parsePublicTeachback(data);
    },
    enabled: !!code,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function parseMarks(raw: unknown): TeachbackMarks | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.total !== "number" || typeof r.correct !== "number" || !Array.isArray(r.marks)) return null;
  return { total: r.total, correct: r.correct, marks: r.marks as TeachbackMarks["marks"] };
}

/** Marks the answers in the database and stores the person's own result. Never touches lesson progress. */
export function useRecordTeachback(code: string) {
  return useMutation({
    mutationFn: async (picks: number[]) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("record_teachback_result", { p_code: code, p_picks: picks });
      if (error) throw error;
      const marks = parseMarks(data);
      if (!marks) throw new Error("teachback result not available");
      return marks;
    },
  });
}

export function useShareTeachback(code: string) {
  return useMutation({
    mutationFn: async (share: boolean) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("share_teachback_with_care_team", { p_code: code, p_share: share });
      if (error) throw error;
      // false means the database refused (for example the lesson could not be saved for the visit): surface it, never look like it worked.
      if (data !== true) throw new Error("teachback share refused");
      return true;
    },
  });
}

export type SharedTeachback = Fn["consultation_shared_teachbacks"]["Returns"][number];

/** For a tied clinician: only what the patient chose to share. The database audits the read. */
export function useSharedTeachbacks(patientId: string) {
  return useQuery({
    queryKey: ["learning-shared-teachbacks", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("consultation_shared_teachbacks", { p_patient: patientId });
      if (error) throw error;
      return (data ?? []) as SharedTeachback[];
    },
    enabled: !!patientId,
  });
}

// ---------------------------------------------------------------------------
// Admin: reading grade
// ---------------------------------------------------------------------------
export function useSetReadingGradeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentId, reason }: { contentId: string; reason: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("set_reading_grade_override", { p_content_id: contentId, p_reason: reason });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["health-education-content"] }),
  });
}

// ---------------------------------------------------------------------------
// Record-triggered lessons
// ---------------------------------------------------------------------------
export const RECORD_GUARD = "record_triggered_lessons_enabled";

export type RecordLessonState =
  | { readonly kind: "off" }
  | { readonly kind: "none" }
  | { readonly kind: "urgent" }
  | { readonly kind: "lesson"; readonly code: string; readonly title: string; readonly body: string };

const DAY_MS = 86_400_000;

async function loadRecordLesson(patientId: string): Promise<RecordLessonState> {
  const supabase = createClient();

  // 1. The go-live guard (INV-14). Off is the default; nothing below runs.
  const open = await supabase.rpc("go_live_guard_is_open", { p_key: RECORD_GUARD });
  if (open.error || open.data !== true) return { kind: "off" };

  // 2. The versioned configuration. A missing or malformed row means no lesson.
  const cfgRow = await supabase.from("learning_config").select("value").eq("key", "record_lessons").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const config = parseRecordLessonConfig(cfgRow.data?.value);
  if (!config) return { kind: "none" };

  // 3. Recent readings, classified by the platform's own classifiers (no threshold lives here).
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
    if (v.vital_type === "blood_pressure") bloodPressure.push({ id: v.id, takenAt: v.taken_at, level: bpLessonLevel(classifyBpLevel(v.systolic, v.diastolic), v.systolic, v.diastolic) });
    else if (v.vital_type === "glucose") glucose.push({ id: v.id, takenAt: v.taken_at, level: glucoseLessonLevel(classifyLatestGlucoseLevel(v.glucose_mmol_l)) });
  }

  // 4. Released lab items only. The database function already drops unreleased, superseded and sensitive-positive results; the selector re-checks.
  const labRes = await supabase.rpc("record_lesson_lab_items");
  // A failed lab read must not look like "no labs": a critical result would silently stop outranking a lesson. Fail closed: no lesson.
  if (labRes.error) return { kind: "none" };
  const labItems: LabItemInput[] = (labRes.data ?? []).map((i) => ({
    id: i.id,
    resultId: i.result_id,
    analyteCode: i.analyte_code,
    flag: i.flag as LabFlag,
    sensitivePositive: i.sensitive_positive,
    releaseState: i.release_state,
    receivedAt: i.received_at,
  }));

  const decision: RecordLessonDecision = selectRecordLesson({ now: new Date().toISOString(), bloodPressure, glucose, labItems }, config);
  if (decision.kind === "urgent") return { kind: "urgent" };
  if (decision.kind !== "lesson") return { kind: "none" };

  // 5. The database re-checks and logs. 'shown' and 'already_shown' both mean it may be displayed; 'refused' means it may not.
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

export const recordLessonKey = (patientId: string) => ["learning-record-lesson", patientId] as const;

export function useRecordLesson(patientId: string) {
  return useQuery({
    queryKey: recordLessonKey(patientId),
    queryFn: () => loadRecordLesson(patientId),
    enabled: !!patientId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
