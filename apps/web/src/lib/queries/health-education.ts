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
