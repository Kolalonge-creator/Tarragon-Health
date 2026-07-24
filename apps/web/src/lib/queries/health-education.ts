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

export type HealthEducationStatus = Enums<"health_education_status">;

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
