import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Enums, Tables } from "@tarragon/shared";

/**
 * Health Education pathway (engagement layer). The feed comes from a SECURITY
 * DEFINER RPC keyed to auth.uid() that ranks the caller's condition/risk-matched
 * content (see 20260717150000_health_education.sql). Progress is a patient-owned
 * "seen / understood / needs_review" row per content item.
 */
export type HealthEducationFeedItem =
  Database["public"]["Functions"]["health_education_feed"]["Returns"][number];

export type HealthEducationLibraryItem =
  Database["public"]["Functions"]["health_education_library"]["Returns"][number];

export type HealthEducationCategoryCount =
  Database["public"]["Functions"]["health_education_category_counts"]["Returns"][number];

export type HealthEducationStatus = Enums<"health_education_status">;
export type HealthEducationCategory = Enums<"health_education_category">;
export type HealthEducationReadingLevel = Enums<"health_education_reading_level">;
export type HealthEducationFeedbackType = Enums<"health_education_feedback_type">;

/** §20.5 reading levels — display order simple → clinician. */
export const HEALTH_EDUCATION_READING_LEVELS: { value: HealthEducationReadingLevel; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "detailed", label: "Detailed" },
  { value: "clinician", label: "Clinician-level" },
];

/** §20.15 patient feedback reactions, in the order they're offered. */
export const HEALTH_EDUCATION_FEEDBACK_OPTIONS: { value: HealthEducationFeedbackType; label: string }[] = [
  { value: "helpful", label: "Helpful" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "unclear", label: "Unclear" },
  { value: "want_more_information", label: "Want more information" },
  { value: "report_incorrect", label: "Report incorrect information" },
];

/** Display order + labels for the browsable category taxonomy — broader than
 * the clinical `condition` used for personalisation, so a patient can read
 * about a topic out of interest, not only if a matching diagnosis is on
 * file. Order is roughly "most commonly relevant first". */
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

export const healthEducationFeedKey = (patientId: string) =>
  ["health-education-feed", patientId] as const;

/** The caller's ranked learning feed (needs_review → un-started → understood). */
export function useHealthEducationFeed(patientId: string) {
  return useQuery({
    queryKey: healthEducationFeedKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_feed");
      if (error) throw error;
      return (data ?? []) as HealthEducationFeedItem[];
    },
    enabled: !!patientId,
  });
}

/**
 * How many otherwise-eligible items are still locked by the weekly drip
 * (drip_week > the caller's current curriculum week). Lets the card say
 * "N more unlock over the coming weeks" instead of content silently not
 * existing.
 */
export function useHealthEducationLockedCount(patientId: string) {
  return useQuery({
    queryKey: ["health-education-locked", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_locked_count");
      if (error) throw error;
      return data ?? 0;
    },
    enabled: !!patientId,
  });
}

/** How many active items live in each browsable category — powers the
 * category picker's count chips without pulling every row's body down. */
export function useHealthEducationCategoryCounts() {
  return useQuery({
    queryKey: ["health-education-category-counts"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_category_counts");
      if (error) throw error;
      return (data ?? []) as HealthEducationCategoryCount[];
    },
  });
}

/**
 * The full browsable library — every active item, optionally filtered to one
 * category, deliberately NOT gated by condition-match, risk floor or the
 * weekly drip (unlike `health_education_feed`, which stays personalised and
 * paced for the "Recommended for you" rail). This is what lets a patient
 * choose a topic out of interest rather than only see what the
 * personalisation algorithm decided was relevant to their own diagnoses.
 */
export function useHealthEducationLibrary(category: HealthEducationCategory | null) {
  return useQuery({
    queryKey: ["health-education-library", category] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_library", {
        p_category: category ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as HealthEducationLibraryItem[];
    },
  });
}

/**
 * Record that the patient has seen / understood / needs to revisit an item.
 * Upsert on the (patient_id, content_id) unique key. check_score/check_total
 * are engagement telemetry only — never clinical.
 */
export function useMarkContentProgress(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentId,
      status,
      checkScore,
      checkTotal,
    }: {
      contentId: string;
      status: HealthEducationStatus;
      checkScore?: number;
      checkTotal?: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_progress").upsert(
        {
          patient_id: patientId,
          organisation_id: organisationId,
          content_id: contentId,
          status,
          check_score: checkScore ?? null,
          check_total: checkTotal ?? null,
          last_viewed_at: new Date().toISOString(),
        },
        { onConflict: "patient_id,content_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationFeedKey(patientId) });
      queryClient.invalidateQueries({ queryKey: ["health-education-library"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin catalogue management. RLS lets an admin read all rows (active or not)
// and is the only role that can write — enforced at the DB (see the migration).
// ---------------------------------------------------------------------------
export type HealthEducationContent = Tables<"health_education_content">;

export const healthEducationCatalogueKey = ["health-education-catalogue"] as const;

/** All catalogue rows (incl. inactive) for the admin, by condition then order. */
export function useHealthEducationCatalogue() {
  return useQuery({
    queryKey: healthEducationCatalogueKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_content")
        .select("*")
        .order("condition", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HealthEducationContent[];
    },
  });
}

export type HealthEducationContentStatus = Enums<"health_education_content_status">;

export const HEALTH_EDUCATION_STATUS_LABELS: Record<HealthEducationContentStatus, string> = {
  draft: "Draft",
  clinical_review: "In clinical review",
  approved: "Approved (not yet published)",
  published: "Published",
  review_due: "Review due",
  updated: "Updated (needs re-review)",
};

export type HealthEducationContentInput = {
  code: string;
  title: string;
  summary?: string | null;
  body: string;
  category: HealthEducationCategory;
  content_type: HealthEducationContent["content_type"];
  condition?: HealthEducationContent["condition"];
  min_risk_level?: HealthEducationContent["min_risk_level"];
  estimated_minutes?: number | null;
  video_url?: string | null;
  audio_url?: string | null;
  author_name?: string | null;
  source_reference?: string | null;
  next_review_due?: string | null;
  min_age?: number | null;
  max_age?: number | null;
};

/** Create a new content item — always lands as content_status='draft' (the
 * column default), which private.health_education_content_sync_is_active()
 * keeps is_active=false for until it's carried through clinical_review ->
 * approved -> published via set_health_education_content_status. */
export function useCreateHealthEducationContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: HealthEducationContentInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_content").insert(input);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey });
    },
  });
}

export function useUpdateHealthEducationContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<HealthEducationContentInput> & { id: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_content").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey });
    },
  });
}

/**
 * Move a content item through its clinical-review lifecycle (draft ->
 * clinical_review -> approved -> published -> review_due/updated -> ...).
 * Always goes through public.set_health_education_content_status, which
 * enforces the legal-transition state machine server-side — never write
 * is_active or content_status directly from the client. is_active is
 * derived from content_status by a DB trigger (published/review_due only);
 * writing it directly would let unreviewed draft content go live to
 * patients with one click, bypassing clinical review entirely.
 */
export function useSetHealthEducationContentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      note,
    }: {
      id: string;
      status: HealthEducationContentStatus;
      note?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_health_education_content_status", {
        p_content_id: id,
        p_new_status: status,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey });
    },
  });
}

/** Admin: set (or clear) an item's curriculum week for the weekly drip. */
export function useSetContentDripWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dripWeek }: { id: string; dripWeek: number | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_content")
        .update({ drip_week: dripWeek })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey });
    },
  });
}

export type HealthEducationContentStatusHistory =
  Tables<"health_education_content_status_history">;

/** Admin: full transition history for one content row (who moved what, when, why). */
export function useContentStatusHistory(contentId: string) {
  return useQuery({
    queryKey: ["health-education-status-history", contentId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_content_status_history")
        .select("*")
        .eq("content_id", contentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HealthEducationContentStatusHistory[];
    },
    enabled: !!contentId,
  });
}

// ---------------------------------------------------------------------------
// Health-literacy self-assessment (§79.7). Engagement-only, patient-owned —
// never touches patient_risk_scores or escalation. See
// docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §1 locked decision #1.
// ---------------------------------------------------------------------------
export type HealthLiteracyAssessment = Tables<"health_literacy_assessments">;

/** The patient's most recent confidence rating, overall or for one condition. */
export function useLatestHealthLiteracy(
  patientId: string,
  condition: Database["public"]["Enums"]["care_plan_condition"] | null = null
) {
  return useQuery({
    queryKey: ["health-literacy-latest", patientId, condition] as const,
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("health_literacy_assessments")
        .select("*")
        .eq("patient_id", patientId)
        .order("assessed_at", { ascending: false })
        .limit(1);
      query = condition ? query.eq("condition", condition) : query.is("condition", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as HealthLiteracyAssessment | null;
    },
    enabled: !!patientId,
  });
}

/** "How confident are you managing your condition?" — a 1-5 self-rating. */
export function useSubmitHealthLiteracyAssessment(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      confidenceLevel,
      condition,
    }: {
      confidenceLevel: 1 | 2 | 3 | 4 | 5;
      condition?: Database["public"]["Enums"]["care_plan_condition"] | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_literacy_assessments").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        confidence_level: confidenceLevel,
        condition: condition ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-literacy-latest", patientId] });
      queryClient.invalidateQueries({ queryKey: healthEducationFeedKey(patientId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Care-event-triggered recommendations (§79.13) — "after a medication
// change" / "after an abnormal result", surfaced via DB triggers into
// health_education_recommendations.
// ---------------------------------------------------------------------------
export type HealthEducationRecommendation = Tables<"health_education_recommendations"> & {
  content: Pick<HealthEducationContent, "id" | "code" | "title" | "summary" | "category"> | null;
};

/** The patient's undismissed recommendations, newest first. */
export function useHealthEducationRecommendations(patientId: string) {
  return useQuery({
    queryKey: ["health-education-recommendations", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_recommendations")
        .select("*, content:health_education_content(id, code, title, summary, category)")
        .eq("patient_id", patientId)
        .is("dismissed_at", null)
        .order("triggered_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HealthEducationRecommendation[];
    },
    enabled: !!patientId,
  });
}

export function useDismissRecommendation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_recommendations")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-education-recommendations", patientId] });
    },
  });
}

export function useMarkRecommendationViewed(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_recommendations")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", id)
        .is("viewed_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-education-recommendations", patientId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: event-trigger mapping management (which content fires on which
// medication/abnormal-result event).
// ---------------------------------------------------------------------------
export type HealthEducationTriggerMapping = Tables<"health_education_trigger_mappings">;

export function useTriggerMappings() {
  return useQuery({
    queryKey: ["health-education-trigger-mappings"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_trigger_mappings")
        .select("*")
        .order("trigger_source", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HealthEducationTriggerMapping[];
    },
  });
}

export function useCreateTriggerMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mapping: {
      triggerSource: "medication" | "abnormal_result";
      matchKey: string;
      targetContentId?: string | null;
      targetCategory?: HealthEducationCategory | null;
      targetCondition?: Database["public"]["Enums"]["care_plan_condition"] | null;
      note?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_trigger_mappings").insert({
        trigger_source: mapping.triggerSource,
        match_key: mapping.matchKey,
        target_content_id: mapping.targetContentId ?? null,
        target_category: mapping.targetCategory ?? null,
        target_condition: mapping.targetCondition ?? null,
        note: mapping.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-education-trigger-mappings"] });
    },
  });
}

export function useSetTriggerMappingActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_trigger_mappings")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-education-trigger-mappings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Translations (§79.9) — admin authoring surface. Deliberately no
// auto-translate: see 20260830015418_health_education_translations.sql for
// why this is a human/clinical-team task, not something generated here.
// ---------------------------------------------------------------------------
export type HealthEducationTranslation = Tables<"health_education_translations">;
export type HealthEducationLanguage = "pcm" | "yo" | "ha" | "ig";

export const HEALTH_EDUCATION_LANGUAGE_LABELS: Record<HealthEducationLanguage, string> = {
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ha: "Hausa",
  ig: "Igbo",
};

export function useContentTranslations(contentId: string) {
  return useQuery({
    queryKey: ["health-education-translations", contentId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_translations")
        .select("*")
        .eq("content_id", contentId);
      if (error) throw error;
      return (data ?? []) as HealthEducationTranslation[];
    },
    enabled: !!contentId,
  });
}

export function useUpsertTranslation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (translation: {
      contentId: string;
      language: HealthEducationLanguage;
      title: string;
      summary?: string | null;
      body: string;
      translatedBy?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_translations").upsert(
        {
          content_id: translation.contentId,
          language: translation.language,
          title: translation.title,
          summary: translation.summary ?? null,
          body: translation.body,
          translated_by: translation.translatedBy ?? null,
          translated_at: new Date().toISOString(),
        },
        { onConflict: "content_id,language" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["health-education-translations", variables.contentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Named learning pathways (§79.6 — REVERSAL of locked decision, see
// docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §1). health_education_programmes
// / _programme_modules and their RPCs already existed live before this
// session's changes; this is the first TS surface for them.
// ---------------------------------------------------------------------------
export type HealthEducationProgrammeListItem =
  Database["public"]["Functions"]["health_education_programmes_list"]["Returns"][number];
export type HealthEducationProgrammeDetailRow =
  Database["public"]["Functions"]["health_education_programme_detail"]["Returns"][number];

export function useHealthEducationProgrammes() {
  return useQuery({
    queryKey: ["health-education-programmes"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_programmes_list");
      if (error) throw error;
      return (data ?? []) as HealthEducationProgrammeListItem[];
    },
  });
}

/** One programme's ordered modules, each carrying the caller's own progress. */
export function useHealthEducationProgrammeDetail(code: string | null) {
  return useQuery({
    queryKey: ["health-education-programme-detail", code] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_programme_detail", {
        p_code: code as string,
      });
      if (error) throw error;
      return (data ?? []) as HealthEducationProgrammeDetailRow[];
    },
    enabled: !!code,
  });
}

// ---------------------------------------------------------------------------
// §20.15 Patient feedback — a reaction on one content item, upserted per
// (patient, content, feedback_type) so a repeat tap updates rather than
// duplicates. "report_incorrect" additionally enters the admin governance
// queue via the row's own status column (see the feedback migration).
// ---------------------------------------------------------------------------
export function useSubmitContentFeedback(patientId: string, organisationId: string) {
  return useMutation({
    mutationFn: async ({
      contentId,
      feedbackType,
      comment,
    }: {
      contentId: string;
      feedbackType: HealthEducationFeedbackType;
      comment?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_feedback").upsert(
        {
          patient_id: patientId,
          organisation_id: organisationId,
          content_id: contentId,
          feedback_type: feedbackType,
          comment: comment?.trim() || null,
        },
        { onConflict: "patient_id,content_id,feedback_type" }
      );
      if (error) throw error;
    },
  });
}

// ---------------------------------------------------------------------------
// Admin governance queue (§20.15) + analytics (§20.18).
// ---------------------------------------------------------------------------
export type HealthEducationFeedbackRow = Tables<"health_education_feedback"> & {
  content: { code: string; title: string } | null;
  patient: { full_name: string | null } | null;
};

const FEEDBACK_QUEUE_SELECT =
  "*, content:health_education_content(code, title), patient:profiles!health_education_feedback_patient_id_fkey(full_name)";

export const healthEducationFeedbackQueueKey = ["health-education-feedback-queue"] as const;

/** All feedback rows, open reports first — the admin governance queue. */
export function useHealthEducationFeedbackQueue() {
  return useQuery({
    queryKey: healthEducationFeedbackQueueKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_feedback")
        .select(FEEDBACK_QUEUE_SELECT)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HealthEducationFeedbackRow[];
    },
  });
}

/** Admin: move a feedback report through the governance queue. */
export function useResolveContentFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reviewNote,
    }: {
      id: string;
      status: "reviewed" | "resolved";
      reviewNote?: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("health_education_feedback")
        .update({
          status,
          review_note: reviewNote?.trim() || null,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationFeedbackQueueKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Learn -> goal -> track (§79.14 — REVERSAL of locked decision #2). Reuses
// the existing, already-governed `care_plan_goals` table and its
// patient-propose RLS policy rather than a new parallel goal system — see
// 20260830022516_health_education_goal_link.sql for the reasoning. A
// patient-proposed goal lands as status='proposed' and waits for clinician
// approval, same as any other patient-sourced goal on the platform.
// ---------------------------------------------------------------------------
export function useProposeGoalFromContent(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentId,
      carePlanId,
      description,
      metric,
      targetValue,
      targetUnit,
      targetDate,
    }: {
      contentId: string;
      carePlanId?: string | null;
      description: string;
      metric?: string | null;
      targetValue?: number | null;
      targetUnit?: string | null;
      targetDate?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_plan_goals").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        care_plan_id: carePlanId ?? null,
        source_content_id: contentId,
        description,
        metric: metric ?? null,
        target_value: targetValue ?? null,
        target_unit: targetUnit ?? null,
        target_date: targetDate ?? null,
        source: "patient",
        status: "proposed",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-plan-goals-from-education", patientId] });
    },
  });
}

export type HealthEducationAnalyticsRow =
  Database["public"]["Functions"]["health_education_analytics"]["Returns"][number];

/** Admin: per-content view/completion/quiz/feedback rollup. */
export function useHealthEducationAnalytics() {
  return useQuery({
    queryKey: ["health-education-analytics"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_analytics");
      if (error) throw error;
      return (data ?? []) as HealthEducationAnalyticsRow[];
    },
  });
}

/** Goals a patient proposed off the back of a lesson — for the "track
 * progress" half of the loop, shown back inside the education surface. */
export function useGoalsFromEducation(patientId: string) {
  return useQuery({
    queryKey: ["care-plan-goals-from-education", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_goals")
        .select("*, source_content:health_education_content(id, code, title)")
        .eq("patient_id", patientId)
        .not("source_content_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
  });
}
