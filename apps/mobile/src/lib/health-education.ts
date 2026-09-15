import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Database, Enums } from "@tarragon/shared";

/**
 * "Learn" — the patient health library. Every read/write here is a plain
 * RLS-scoped RPC or table call, mirroring apps/web/src/lib/queries/
 * health-education.ts's patient-facing functions exactly (the admin
 * catalogue-management, feedback-governance-queue, and translation
 * functions in that file have no mobile equivalent and are left alone).
 *
 * Deliberately NOT ported this pass: named "Learning pathways" programmes
 * (health_education_programmes_list/_detail — a self-contained syllabus
 * feature on top of the same content) and "set a goal from this lesson"
 * (care_plan_goals via useProposeGoalFromContent — goal creation already
 * has a native home in lifestyle-screen.tsx's AddGoalForm). Both are real,
 * separable features, not safety-relevant, and can follow in a later pass
 * without blocking the core browse/recommend/knowledge-check loop.
 */
export type HealthEducationCategory = Enums<"health_education_category">;
export type HealthEducationReadingLevel = Enums<"health_education_reading_level">;
export type HealthEducationStatus = Enums<"health_education_status">;
export type HealthEducationFeedbackType = Enums<"health_education_feedback_type">;

export const HEALTH_EDUCATION_CATEGORIES: { value: HealthEducationCategory; label: string }[] = [
  { value: "hypertension", label: "Blood pressure" },
  { value: "diabetes", label: "Diabetes" },
  { value: "heart", label: "Heart health" },
  { value: "weight", label: "Weight & metabolic health" },
  { value: "kidney", label: "Kidney health" },
  { value: "respiratory", label: "Breathing & lungs" },
  { value: "nutrition", label: "Nutrition & everyday habits" },
  { value: "mental_health", label: "Mental & emotional wellbeing" },
  { value: "cancer_screening", label: "Cancer & screening" },
  { value: "womens_health", label: "Women's health" },
  { value: "mens_health", label: "Men's health" },
  { value: "medicines", label: "Medicines & adherence" },
  { value: "family_child", label: "Family & child health" },
  { value: "exercise", label: "Exercise & movement" },
  { value: "sleep", label: "Sleep" },
  { value: "vaccination", label: "Vaccination" },
  { value: "getting_started", label: "Getting started with Tarragon" },
];

export const HEALTH_EDUCATION_READING_LEVELS: { value: HealthEducationReadingLevel; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "detailed", label: "Detailed" },
  { value: "clinician", label: "Clinician-level" },
];

export const HEALTH_EDUCATION_FEEDBACK_OPTIONS: { value: HealthEducationFeedbackType; label: string }[] = [
  { value: "helpful", label: "Helpful" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "unclear", label: "Unclear" },
  { value: "want_more_information", label: "Want more information" },
  { value: "report_incorrect", label: "Report incorrect information" },
];

export type EducationItem =
  Database["public"]["Functions"]["health_education_feed"]["Returns"][number];
export type LibraryItem =
  Database["public"]["Functions"]["health_education_library"]["Returns"][number];
export type AnyEducationItem = EducationItem | LibraryItem;

export async function loadHealthEducationFeed(): Promise<EducationItem[]> {
  const { data, error } = await supabase.rpc("health_education_feed");
  if (error) throw error;
  return data ?? [];
}

export async function loadHealthEducationLockedCount(): Promise<number> {
  const { data, error } = await supabase.rpc("health_education_locked_count");
  if (error) throw error;
  return data ?? 0;
}

export interface CategoryCount {
  category: HealthEducationCategory;
  item_count: number;
}

export async function loadHealthEducationCategoryCounts(): Promise<CategoryCount[]> {
  const { data, error } = await supabase.rpc("health_education_category_counts");
  if (error) throw error;
  return (data ?? []) as CategoryCount[];
}

export async function loadHealthEducationLibrary(category: HealthEducationCategory | null): Promise<LibraryItem[]> {
  const { data, error } = await supabase.rpc("health_education_library", { p_category: category ?? undefined });
  if (error) throw error;
  return data ?? [];
}

/** Upsert on (patient_id, content_id) — mirrors useMarkContentProgress. */
export async function markContentProgress(
  patientId: string,
  organisationId: string,
  input: { contentId: string; status: HealthEducationStatus; checkScore?: number; checkTotal?: number }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("health_education_progress").upsert(
    {
      patient_id: patientId,
      organisation_id: organisationId,
      content_id: input.contentId,
      status: input.status,
      check_score: input.checkScore ?? null,
      check_total: input.checkTotal ?? null,
      last_viewed_at: new Date().toISOString(),
    },
    { onConflict: "patient_id,content_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function submitContentFeedback(
  patientId: string,
  organisationId: string,
  input: { contentId: string; feedbackType: HealthEducationFeedbackType; comment?: string }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("health_education_feedback").upsert(
    {
      patient_id: patientId,
      organisation_id: organisationId,
      content_id: input.contentId,
      feedback_type: input.feedbackType,
      comment: input.comment?.trim() || null,
    },
    { onConflict: "patient_id,content_id,feedback_type" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Knowledge checks — pure functions, mirroring
// apps/web/src/lib/validation/health-education.ts exactly. Engagement
// telemetry only, never a clinical assessment.
// ---------------------------------------------------------------------------
export interface KnowledgeCheckQuestion {
  question: string;
  options: string[];
  answer_index: number;
}

/** Parse the raw jsonb into typed questions, or null if it isn't a usable
 * check — a malformed admin/seed-authored row degrades to "no check"
 * rather than throwing. */
export function parseKnowledgeCheck(raw: unknown): KnowledgeCheckQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: KnowledgeCheckQuestion[] = [];
  for (const item of raw) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).question !== "string" ||
      !(item as Record<string, unknown>).question ||
      !Array.isArray((item as Record<string, unknown>).options) ||
      ((item as Record<string, unknown>).options as unknown[]).length < 2 ||
      !((item as Record<string, unknown>).options as unknown[]).every((o) => typeof o === "string" && o.length > 0) ||
      typeof (item as Record<string, unknown>).answer_index !== "number" ||
      ((item as Record<string, unknown>).answer_index as number) < 0
    ) {
      continue;
    }
    const q = item as unknown as KnowledgeCheckQuestion;
    if (q.answer_index < q.options.length) questions.push(q);
  }
  return questions.length > 0 ? questions : null;
}

export interface KnowledgeCheckResult {
  score: number;
  total: number;
  allCorrect: boolean;
}

export function scoreKnowledgeCheck(
  questions: KnowledgeCheckQuestion[],
  answers: ReadonlyArray<number | undefined>
): KnowledgeCheckResult {
  const total = questions.length;
  const score = questions.reduce((acc, q, i) => (answers[i] === q.answer_index ? acc + 1 : acc), 0);
  return { score, total, allCorrect: total > 0 && score === total };
}

export function statusFromCheck(result: KnowledgeCheckResult): "understood" | "needs_review" {
  return result.allCorrect ? "understood" : "needs_review";
}

// ---------------------------------------------------------------------------
// Care-event-triggered recommendations (§79.13) — "after a medication
// change" / "after an abnormal result".
// ---------------------------------------------------------------------------
export interface EducationRecommendation {
  id: string;
  trigger_reason: string;
  viewed_at: string | null;
  content: { id: string; title: string; summary: string | null } | null;
}

export async function loadHealthEducationRecommendations(patientId: string): Promise<EducationRecommendation[]> {
  const { data, error } = await supabase
    .from("health_education_recommendations")
    .select("id, trigger_reason, viewed_at, content:health_education_content(id, title, summary)")
    .eq("patient_id", patientId)
    .is("dismissed_at", null)
    .order("triggered_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EducationRecommendation[];
}

export async function dismissRecommendation(id: string): Promise<void> {
  await supabase.from("health_education_recommendations").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
}

export async function markRecommendationViewed(id: string): Promise<void> {
  await supabase
    .from("health_education_recommendations")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("viewed_at", null);
}

// ---------------------------------------------------------------------------
// Health literacy self-assessment — "how confident do you feel?"
// ---------------------------------------------------------------------------
export async function loadLatestHealthLiteracy(patientId: string, condition: string | null): Promise<{ id: string } | null> {
  let query = supabase.from("health_literacy_assessments").select("id").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(1);
  query = condition ? query.eq("condition", condition as never) : query.is("condition", null);
  const { data } = await query.maybeSingle();
  return data ?? null;
}

export async function submitHealthLiteracyAssessment(
  patientId: string,
  organisationId: string,
  input: { confidenceLevel: 1 | 2 | 3 | 4 | 5; condition?: string | null }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("health_literacy_assessments").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    confidence_level: input.confidenceLevel,
    condition: (input.condition ?? null) as never,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** The caller's first care-plan condition, used only to decide which
 * condition (if any) the literacy prompt asks about. */
export async function loadFirstCarePlanCondition(patientId: string): Promise<string | null> {
  const { data } = await supabase.from("care_plans").select("condition").eq("patient_id", patientId).limit(1).maybeSingle();
  return data?.condition ?? null;
}
