import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

type Spo2Target = Database["public"]["Tables"]["patient_spo2_targets"]["Row"];
type TemperatureTarget = Database["public"]["Tables"]["patient_temperature_targets"]["Row"];
type PulseTarget = Database["public"]["Tables"]["patient_pulse_targets"]["Row"];

/** The calling clinician's clinical_staff.id, for set_by attribution — same
 * lookup pattern as public.clear_vitals_validation_flag(). Null (not an
 * error) for an org-staff caller with no clinical_staff row (e.g. an
 * admin), in which case set_by is simply left unattributed. */
async function currentClinicalStaffId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("clinical_staff").select("id").eq("profile_id", user.id).maybeSingle();
  return data?.id ?? null;
}

export function useSpo2Target(patientId: string) {
  return useQuery({
    queryKey: ["spo2-target", patientId],
    queryFn: async (): Promise<Spo2Target | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_spo2_targets")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useTemperatureTarget(patientId: string) {
  return useQuery({
    queryKey: ["temperature-target", patientId],
    queryFn: async (): Promise<TemperatureTarget | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_temperature_targets")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function usePulseTarget(patientId: string) {
  return useQuery({
    queryKey: ["pulse-target", patientId],
    queryFn: async (): Promise<PulseTarget | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_pulse_targets")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useUpsertSpo2Target() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      patientId: string;
      organisationId: string;
      amberThresholdPct: number;
      rationale: string | null;
    }) => {
      const supabase = createClient();
      const setBy = await currentClinicalStaffId();
      const { error } = await supabase.from("patient_spo2_targets").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          amber_threshold_pct: input.amberThresholdPct,
          rationale: input.rationale,
          set_by: setBy,
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_d, variables) => {
      queryClient.invalidateQueries({ queryKey: ["spo2-target", variables.patientId] });
    },
  });
}

export function useUpsertTemperatureTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      patientId: string;
      organisationId: string;
      amberThresholdC: number;
      rationale: string | null;
    }) => {
      const supabase = createClient();
      const setBy = await currentClinicalStaffId();
      const { error } = await supabase.from("patient_temperature_targets").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          amber_threshold_c: input.amberThresholdC,
          rationale: input.rationale,
          set_by: setBy,
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_d, variables) => {
      queryClient.invalidateQueries({ queryKey: ["temperature-target", variables.patientId] });
    },
  });
}

export function useUpsertPulseTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      patientId: string;
      organisationId: string;
      restingMinBpm: number;
      restingMaxBpm: number;
      rationale: string | null;
    }) => {
      const supabase = createClient();
      const setBy = await currentClinicalStaffId();
      const { error } = await supabase.from("patient_pulse_targets").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          resting_min_bpm: input.restingMinBpm,
          resting_max_bpm: input.restingMaxBpm,
          rationale: input.rationale,
          set_by: setBy,
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_d, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pulse-target", variables.patientId] });
    },
  });
}
