import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { MedicationAccessCheckinInput } from "@/lib/validation/medication-access";
import type { MedicationSideEffectReportInput } from "@/lib/validation/medication-access";
import type { MedicationReminderPreferencesInput } from "@/lib/validation/medication-access";

export type MedicationAccessCheckin = Tables<"medication_access_checkins">;
export type MedicationSideEffectReport = Tables<"medication_side_effect_reports">;
export type MedicationReminderPreferences = Tables<"medication_reminder_preferences">;
export type MedicationEducationTopic = Tables<"medication_education_topics">;
export type MedicationAccessDashboardRow = Tables<"medication_access_dashboard_v">;
export type MedicationAdherenceMonthly = Tables<"medication_adherence_monthly_v">;

// ---------------------------------------------------------------------------
// §21.3 affordability check-in
// ---------------------------------------------------------------------------

export function useMedicationAccessCheckins(medicationId: string) {
  return useQuery({
    queryKey: ["medication-access-checkins", medicationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_access_checkins")
        .select("*")
        .eq("medication_id", medicationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as MedicationAccessCheckin[];
    },
    enabled: !!medicationId,
  });
}

/**
 * Submits §21.3's "Were you able to obtain your medication?" check-in.
 * access_status/adherence_status on the medication itself are derived
 * server-side (private.handle_medication_access_checkin) — this mutation
 * never writes those columns directly.
 */
export function useSubmitMedicationAccessCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationAccessCheckinInput & { patientId: string; organisationId: string }
    ) => {
      const { patientId, organisationId, ...rest } = input;
      const supabase = createClient();
      const { error } = await supabase.from("medication_access_checkins").insert({
        ...rest,
        barrier: rest.barrier ?? null,
        notes: rest.notes?.trim() || null,
        patient_id: patientId,
        organisation_id: organisationId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["medication-access-checkins", variables.medication_id] });
      queryClient.invalidateQueries({ queryKey: ["medications", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["medication-access-dashboard"] });
    },
  });
}

// ---------------------------------------------------------------------------
// §21.11 side-effect reports
// ---------------------------------------------------------------------------

export function useMedicationSideEffectReports(medicationId: string) {
  return useQuery({
    queryKey: ["medication-side-effect-reports", medicationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_side_effect_reports")
        .select("*")
        .eq("medication_id", medicationId)
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as MedicationSideEffectReport[];
    },
    enabled: !!medicationId,
  });
}

export function useSubmitMedicationSideEffectReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationSideEffectReportInput & { patientId: string; organisationId: string }
    ) => {
      const { patientId, organisationId, ...rest } = input;
      const supabase = createClient();
      const { error } = await supabase.from("medication_side_effect_reports").insert({
        ...rest,
        checkin_id: rest.checkin_id ?? null,
        patient_id: patientId,
        organisation_id: organisationId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["medication-side-effect-reports", variables.medication_id],
      });
      queryClient.invalidateQueries({ queryKey: ["medication-access-dashboard"] });
    },
  });
}

// ---------------------------------------------------------------------------
// §21.13 reminder preferences (one row per patient)
// ---------------------------------------------------------------------------

export function useMedicationReminderPreferences(patientId: string) {
  return useQuery({
    queryKey: ["medication-reminder-preferences", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_reminder_preferences")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data as MedicationReminderPreferences | null;
    },
    enabled: !!patientId,
  });
}

/** Upserts the patient's own reminder preferences (RLS: patient-own-row only). */
export function useUpdateMedicationReminderPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationReminderPreferencesInput & { patientId: string; organisationId: string }
    ) => {
      const { patientId, organisationId, ...rest } = input;
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_reminder_preferences")
        .upsert(
          { ...rest, patient_id: patientId, organisation_id: organisationId },
          { onConflict: "patient_id" }
        );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["medication-reminder-preferences", variables.patientId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// §21.12 medication education (small public reference table, fetched once)
// ---------------------------------------------------------------------------

export function useMedicationEducationTopics() {
  return useQuery({
    queryKey: ["medication-education-topics"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_education_topics")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data as MedicationEducationTopic[];
    },
    staleTime: 60 * 60 * 1000, // reference data, rarely changes
  });
}

/** Mirrors the ILIKE match_pattern semantics used server-side (drug_monitoring_rules/medication_education_topics). */
export function findEducationTopic(
  topics: MedicationEducationTopic[],
  drugName: string
): MedicationEducationTopic | null {
  const name = drugName.toLowerCase();
  for (const topic of topics) {
    const escaped = topic.match_pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped.replace(/%/g, ".*")}$`, "i");
    if (pattern.test(name)) return topic;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §21.10 adherence trend + §21.15/§21.16 clinical-team dashboard
// ---------------------------------------------------------------------------

export function useMedicationAdherenceMonthly(medicationId: string) {
  return useQuery({
    queryKey: ["medication-adherence-monthly", medicationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_adherence_monthly_v")
        .select("*")
        .eq("medication_id", medicationId)
        .order("month", { ascending: true });
      if (error) throw error;
      return data as MedicationAdherenceMonthly[];
    },
    enabled: !!medicationId,
  });
}

/** Care-team worklist (§21.15) — RLS (is_org_staff) scopes this to the caller's org automatically. */
export function useMedicationAccessDashboard() {
  return useQuery({
    queryKey: ["medication-access-dashboard"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_access_dashboard_v")
        .select("*")
        .neq("next_action", "None — on track")
        .order("adherence_pct_30d", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as MedicationAccessDashboardRow[];
    },
  });
}
