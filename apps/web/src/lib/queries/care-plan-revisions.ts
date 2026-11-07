import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import type { CarePlanRevision, PlanActionView } from "@/lib/care-plan/plan-view";

type Client = SupabaseClient<Database>;

/** A live action on one of the patient's plans, in the shape the patient page renders. */
export type PatientPlanAction = PlanActionView & { carePlanId: string };

/**
 * PD-06: the active actions on the given plans (RLS: the patient's own, or a supporter's care-plan grant). Throws on a
 * failed read so the page can say "Couldn't load", never "nothing here".
 */
export async function fetchPatientCarePlanActions(supabase: Client, carePlanIds: readonly string[]): Promise<PatientPlanAction[]> {
  if (carePlanIds.length === 0) return [];
  const { data, error } = await supabase
    .from("care_plan_interventions")
    .select("care_plan_id, description, frequency, category, why_text, when_text, how_text, created_at")
    .in("care_plan_id", [...carePlanIds])
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    row.care_plan_id
      ? [
          {
            carePlanId: row.care_plan_id,
            description: row.description,
            frequency: row.frequency,
            category: row.category,
            why: row.why_text,
            when: row.when_text,
            how: row.how_text,
          },
        ]
      : [],
  );
}

/** PD-06: every published version of the patient's plans, newest first. Throws on a failed read. */
export async function fetchPatientCarePlanRevisions(supabase: Client, patientId: string): Promise<CarePlanRevision[]> {
  const { data, error } = await supabase
    .from("care_plan_revisions")
    .select("*")
    .eq("patient_id", patientId)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** PD-06: the published versions of one plan, newest first (clinician view). Throws on a failed read. */
export async function fetchCarePlanRevisionsForPlan(supabase: Client, carePlanId: string): Promise<CarePlanRevision[]> {
  const { data, error } = await supabase
    .from("care_plan_revisions")
    .select("*")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** PD-06: publish a plan change. The database function checks the caller is a doctor allowed to write this patient's plan. */
export async function publishCarePlanRevision(
  supabase: Client,
  input: { carePlanId: string; changeSummary: string; needsAcknowledgement: boolean },
): Promise<string> {
  const { data, error } = await supabase.rpc("publish_care_plan_revision", {
    p_care_plan: input.carePlanId,
    p_change_summary: input.changeSummary,
    p_needs_acknowledgement: input.needsAcknowledgement,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("The change was not saved.");
  return data;
}

/** PD-06: set the plan's review dates (staff write through the existing care_plans UPDATE policy). */
export async function updateCarePlanReviewDates(
  supabase: Client,
  input: { carePlanId: string; lastReviewedAt: string | null; nextReviewAt: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from("care_plans")
    .update({ last_reviewed_at: input.lastReviewedAt, next_review_at: input.nextReviewAt })
    .eq("id", input.carePlanId)
    .select("id");
  if (error) throw error;
  // RLS hides a refused update as zero rows; never report that as saved
  if (!data || data.length === 0) throw new Error("You cannot change this plan's review dates.");
}

export const carePlanRevisionKeys = {
  patientActions: (ids: readonly string[]) => ["care-plan-revisions", "actions", ...ids] as const,
  patientRevisions: (patientId: string) => ["care-plan-revisions", "patient", patientId] as const,
  plan: (carePlanId: string) => ["care-plan-revisions", "plan", carePlanId] as const,
};

export function usePatientCarePlanActions(carePlanIds: readonly string[], enabled: boolean) {
  return useQuery({
    queryKey: carePlanRevisionKeys.patientActions(carePlanIds),
    queryFn: () => fetchPatientCarePlanActions(createClient(), carePlanIds),
    enabled,
  });
}

export function usePatientCarePlanRevisions(patientId: string) {
  return useQuery({
    queryKey: carePlanRevisionKeys.patientRevisions(patientId),
    queryFn: () => fetchPatientCarePlanRevisions(createClient(), patientId),
    enabled: !!patientId,
  });
}

export function useCarePlanRevisionsForPlan(carePlanId: string) {
  return useQuery({
    queryKey: carePlanRevisionKeys.plan(carePlanId),
    queryFn: () => fetchCarePlanRevisionsForPlan(createClient(), carePlanId),
    enabled: !!carePlanId,
  });
}

export function usePublishCarePlanRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { carePlanId: string; changeSummary: string; needsAcknowledgement: boolean }) =>
      publishCarePlanRevision(createClient(), input),
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: carePlanRevisionKeys.plan(variables.carePlanId) });
    },
  });
}

export function useUpdateCarePlanReviewDates(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { carePlanId: string; lastReviewedAt: string | null; nextReviewAt: string | null }) =>
      updateCarePlanReviewDates(createClient(), input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-plan-management", "plans", patientId] });
    },
  });
}
