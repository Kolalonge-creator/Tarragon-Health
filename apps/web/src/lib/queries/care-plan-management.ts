import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlanRow = Tables<"care_plans">;
export type CarePlanGoal = Tables<"care_plan_goals">;
export type CarePlanIntervention = Tables<"care_plan_interventions">;
export type CarePlanVersion = Tables<"care_plan_versions">;

function plansKey(patientId: string) {
  return ["care-plan-management", "plans", patientId];
}
function goalsKey(carePlanId: string) {
  return ["care-plan-management", "goals", carePlanId];
}
function interventionsKey(carePlanId: string) {
  return ["care-plan-management", "interventions", carePlanId];
}
function versionsKey(carePlanId: string) {
  return ["care-plan-management", "versions", carePlanId];
}

/** Every care plan regardless of status — the clinician management view,
 * distinct from useCarePlans (patient-facing, active-only). A draft plan
 * needs to be visible here precisely because it hasn't been approved yet. */
export function useCarePlansForManagement(patientId: string) {
  return useQuery({
    queryKey: plansKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plans")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarePlanRow[];
    },
    enabled: !!patientId,
  });
}

/**
 * Care Team / Provider Workspace §5.14's status stepper: draft
 * (accepted from a recommendation) -> active (approved) -> paused/
 * discharged/completed. Every transition is a plain care_plans update, so
 * care_plans_snapshot_version (20260827205255) versions it automatically —
 * no separate "record a version" call needed anywhere in this file.
 */
export function useUpdateCarePlanStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      carePlanId,
      status,
    }: {
      carePlanId: string;
      patientId: string;
      status: CarePlanRow["status"];
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_plans").update({ status }).eq("id", carePlanId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: plansKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: versionsKey(variables.carePlanId) });
    },
  });
}

export function useCarePlanGoals(carePlanId: string) {
  return useQuery({
    queryKey: goalsKey(carePlanId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_goals")
        .select("*")
        .eq("care_plan_id", carePlanId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CarePlanGoal[];
    },
    enabled: !!carePlanId,
  });
}

export function useAddCarePlanGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      carePlanId,
      organisationId,
      patientId,
      description,
    }: {
      carePlanId: string;
      organisationId: string;
      patientId: string;
      description: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("care_plan_goals").insert({
        care_plan_id: carePlanId,
        organisation_id: organisationId,
        patient_id: patientId,
        description,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: goalsKey(variables.carePlanId) });
    },
  });
}

export function useUpdateCarePlanGoalStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      status,
    }: {
      goalId: string;
      carePlanId: string;
      status: "achieved" | "abandoned";
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_goals")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: goalsKey(variables.carePlanId) });
    },
  });
}

export function useCarePlanInterventions(carePlanId: string) {
  return useQuery({
    queryKey: interventionsKey(carePlanId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_interventions")
        .select("*")
        .eq("care_plan_id", carePlanId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CarePlanIntervention[];
    },
    enabled: !!carePlanId,
  });
}

export function useAddCarePlanIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      carePlanId,
      organisationId,
      patientId,
      description,
      frequency,
    }: {
      carePlanId: string;
      organisationId: string;
      patientId: string;
      description: string;
      frequency: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("care_plan_interventions").insert({
        care_plan_id: carePlanId,
        organisation_id: organisationId,
        patient_id: patientId,
        description,
        frequency,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: interventionsKey(variables.carePlanId) });
    },
  });
}

export function useRemoveCarePlanIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ interventionId }: { interventionId: string; carePlanId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_interventions")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", interventionId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: interventionsKey(variables.carePlanId) });
    },
  });
}

export function useCarePlanVersions(carePlanId: string) {
  return useQuery({
    queryKey: versionsKey(carePlanId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_versions")
        .select("*")
        .eq("care_plan_id", carePlanId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data as CarePlanVersion[];
    },
    enabled: !!carePlanId,
  });
}
