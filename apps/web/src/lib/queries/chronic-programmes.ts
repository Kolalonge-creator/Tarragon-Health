import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type ChronicProgramme = Tables<"chronic_condition_programmes">;
export type ConditionProtocol = Tables<"condition_protocols">;
export type ChronicEnrolment = Tables<"chronic_programme_enrolments">;

const enrolmentsKey = (patientId: string) =>
  ["chronic-enrolments", patientId] as const;
const adminProgrammesKey = ["chronic-programmes", "admin", "all"] as const;

/**
 * Active chronic-condition programmes — the founder's phased catalogue. Only
 * is_active rows are visible to patients/clinicians (RLS enforces this too), so
 * this is what powers enrolment surfaces. Ordered launch cohort first.
 */
export function useActiveChronicProgrammes() {
  return useQuery({
    queryKey: ["chronic-programmes", "active"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_condition_programmes")
        .select("*")
        .eq("is_active", true)
        .order("launch_priority", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as ChronicProgramme[];
    },
  });
}

/**
 * Every chronic programme, active + dormant — admin console only. RLS lets an
 * admin read dormant rows (`is_active OR is_admin()`); a non-admin gets only
 * active rows back, so this is safe to call anywhere but only useful in /admin.
 */
export function useAllChronicProgrammes() {
  return useQuery({
    queryKey: adminProgrammesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_condition_programmes")
        .select("*")
        .order("launch_priority", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as ChronicProgramme[];
    },
  });
}

/** WHO-based reference protocols, keyed by condition. Readable by any signed-in user. */
export function useConditionProtocols() {
  return useQuery({
    queryKey: ["condition-protocols"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("condition_protocols").select("*");
      if (error) throw error;
      return data as ConditionProtocol[];
    },
  });
}

/**
 * Admin flips a programme's is_active flag. Activation is gated at the DB by a
 * signed protocol_versions row for the programme's protocol_slug — if none
 * exists the trigger raises a check_violation and the thrown error carries the
 * "sign the protocol first" message straight to the UI. Deactivation always
 * succeeds.
 */
export function useSetChronicProgrammeActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("chronic_condition_programmes")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chronic-programmes"] });
    },
  });
}

/** The patient's active chronic-programme enrolments (patient- or staff-visible via RLS). */
export function useChronicEnrolments(patientId: string) {
  return useQuery({
    queryKey: enrolmentsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_programme_enrolments")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "enrolled");
      if (error) throw error;
      return data as ChronicEnrolment[];
    },
    enabled: !!patientId,
  });
}

/**
 * Staff enrols a diagnosed patient into a chronic programme (the pathway's
 * "programme enrolment" step). Chronic enrolment is clinician-initiated — the
 * insert RLS is org-staff-only, and the DB gate refuses any programme that
 * isn't currently is_active, so a dormant condition can never be enrolled even
 * if the UI slips. The patient's organisation is resolved server-side from
 * their profile so the caller only supplies patient + programme.
 */
export function useEnrolChronicProgramme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      programmeId,
      source = "clinician",
      notes,
    }: {
      patientId: string;
      programmeId: string;
      source?: Enums<"chronic_enrolment_source">;
      notes?: string;
    }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }
      const { error } = await supabase.from("chronic_programme_enrolments").insert({
        organisation_id: profile.organisation_id,
        patient_id: patientId,
        programme_id: programmeId,
        source,
        notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: enrolmentsKey(variables.patientId) });
    },
  });
}

/** Staff withdraws a chronic enrolment (status -> withdrawn). */
export function useWithdrawChronicEnrolment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enrolmentId,
    }: {
      enrolmentId: string;
      patientId: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("chronic_programme_enrolments")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", enrolmentId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: enrolmentsKey(variables.patientId) });
    },
  });
}
