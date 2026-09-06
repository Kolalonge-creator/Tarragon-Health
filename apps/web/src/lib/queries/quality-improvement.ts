import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type QualityImprovementCycle = Tables<"quality_improvement_cycles">;

const QUERY_KEY = ["quality-improvement-cycles"];

async function getCallerOrganisationId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) throw new Error("This account has no organisation on file");
  return profile.organisation_id;
}

/** Every QI cycle in the caller's org, newest first. */
export function useQualityImprovementCycles() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("quality_improvement_cycles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as QualityImprovementCycle[];
    },
  });
}

/** Opens a new cycle: Measure (baseline) + Identify gap. Requires clinical tier. */
export function useCreateQualityImprovementCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      condition?: QualityImprovementCycle["condition"];
      metricSource: string;
      baselineValue?: number;
      baselineMeasuredAt: string;
      gapDescription: string;
      targetValue?: number;
    }) => {
      const supabase = createClient();
      const organisationId = await getCallerOrganisationId();
      const { error } = await supabase.from("quality_improvement_cycles").insert({
        organisation_id: organisationId,
        condition: input.condition ?? null,
        metric_source: input.metricSource,
        baseline_value: input.baselineValue ?? null,
        baseline_measured_at: input.baselineMeasuredAt,
        gap_description: input.gapDescription,
        target_value: input.targetValue ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/** Records the Intervention step, moving the cycle to intervention_active. */
export function useStartQualityImprovementIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { cycleId: string; intervention: string; interventionStartedAt: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("quality_improvement_cycles")
        .update({
          status: "intervention_active",
          intervention: input.intervention,
          intervention_started_at: input.interventionStartedAt,
        })
        .eq("id", input.cycleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/** Records the Re-measure step and closes the cycle. */
export function useRemeasureQualityImprovementCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      cycleId: string;
      remeasureValue: number;
      remeasuredAt: string;
      outcomeNote?: string;
      close?: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("quality_improvement_cycles")
        .update({
          status: input.close ? "closed" : "remeasured",
          remeasure_value: input.remeasureValue,
          remeasured_at: input.remeasuredAt,
          outcome_note: input.outcomeNote || null,
        })
        .eq("id", input.cycleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
