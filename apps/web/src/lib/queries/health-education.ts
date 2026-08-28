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

/** Toggle a catalogue item live/hidden. */
export function useSetContentActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_content")
        .update({ is_active: isActive })
        .eq("id", id);
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

/** Admin: set (or clear) an item's next scheduled review date (§20.8 content safety). */
export function useSetContentReviewDueAt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reviewDueAt }: { id: string; reviewDueAt: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("health_education_content")
        .update({ review_due_at: reviewDueAt })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey });
    },
  });
}

// ---------------------------------------------------------------------------
// §20.13 Education programmes — an ordered module sequence built from existing
// catalogue content (see health_education_programmes/_modules migrations).
// ---------------------------------------------------------------------------
export type HealthEducationProgrammeSummary =
  Database["public"]["Functions"]["health_education_programmes_list"]["Returns"][number];
export type HealthEducationProgrammeModule =
  Database["public"]["Functions"]["health_education_programme_detail"]["Returns"][number];

/** Active programmes with the caller's own module/completion counts. */
export function useHealthEducationProgrammes() {
  return useQuery({
    queryKey: ["health-education-programmes"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_programmes_list");
      if (error) throw error;
      return (data ?? []) as HealthEducationProgrammeSummary[];
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
      return (data ?? []) as HealthEducationProgrammeModule[];
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
