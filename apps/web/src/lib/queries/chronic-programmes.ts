import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type ChronicProgramme = Tables<"chronic_condition_programmes">;
export type ConditionProtocol = Tables<"condition_protocols">;
export type ChronicEnrolment = Tables<"chronic_programme_enrolments">;
export type ChronicScheduleOccurrence = Tables<"chronic_programme_schedule_occurrences">;
export type ChronicProgrammeEndReview = Tables<"chronic_programme_end_reviews">;
export type MedicationDoseHistoryRow = Tables<"medication_dose_history">;

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

export type HtnQualityMetrics = {
  htn_patients: number;
  with_home_average: number;
  at_target: number;
  control_rate_pct: number | null;
  open_red_alerts: number;
  open_amber_alerts: number;
  bp_emergencies_30d: number;
  patients_missing_readings: number;
};

/**
 * H16 (TH-CP-HTN-001 §22) clinical-audit KPIs — control rate, open red-flag
 * alerts, 30-day emergencies, overdue-reading count. The RPC itself enforces
 * `private.is_org_staff(p_org)`, so this is safe to call from any admin/staff
 * surface; org id must be the caller's own (passed down from a server
 * component that already resolved it via getCurrentProfile()).
 */
export function useHtnQualityMetrics(organisationId: string | null | undefined) {
  return useQuery({
    queryKey: ["htn-quality-metrics", organisationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("htn_quality_metrics", {
        p_org: organisationId as string,
      });
      if (error) throw error;
      return data as unknown as HtnQualityMetrics;
    },
    enabled: !!organisationId,
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

// ---------------------------------------------------------------------------
// 12-week two-track programme: weekly schedule occurrences, the end-of-
// programme review shell, and titration history. See
// 20260831163544_chronic_programme_schedule_tables.sql /
// 20260831170512_chronic_programme_end_reviews.sql /
// 20260831165944_chronic_programme_pooled_booking_and_titration.sql.
// ---------------------------------------------------------------------------

const occurrencesKey = (enrolmentId: string) => ["chronic-schedule-occurrences", enrolmentId] as const;

/** The 12-week schedule for one enrolment, in week order — everything a
 * patient or clinician needs to render the programme timeline. */
export function useProgrammeScheduleOccurrences(enrolmentId: string | null | undefined) {
  return useQuery({
    queryKey: occurrencesKey(enrolmentId ?? ""),
    enabled: !!enrolmentId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_programme_schedule_occurrences")
        .select("*")
        .eq("enrolment_id", enrolmentId as string)
        .order("week_number", { ascending: true });
      if (error) throw error;
      return data as ChronicScheduleOccurrence[];
    },
  });
}

/** Links a just-booked appointment back to its doctor_checkin occurrence —
 * the patient can't write chronic_programme_schedule_occurrences.appointment_id
 * directly (RLS is staff-only), so this goes through
 * public.link_chronic_checkin_appointment instead. */
export function useLinkChronicCheckinAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      occurrenceId,
      appointmentId,
    }: {
      occurrenceId: string;
      appointmentId: string;
      enrolmentId: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("link_chronic_checkin_appointment", {
        p_occurrence_id: occurrenceId,
        p_appointment_id: appointmentId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: occurrencesKey(variables.enrolmentId) });
    },
  });
}

/** The (auto-created-empty) week-12 review shell for one enrolment. */
export function useProgrammeEndReview(enrolmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["chronic-end-review", enrolmentId],
    enabled: !!enrolmentId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_programme_end_reviews")
        .select("*")
        .eq("enrolment_id", enrolmentId as string)
        .maybeSingle();
      if (error) throw error;
      return data as ChronicProgrammeEndReview | null;
    },
  });
}

/** The real appointments behind a set of doctor_checkin occurrences — real
 * per-call attribution (whichever doctor actually took the call), never a
 * promise of the same doctor across all 3 calls. */
export function useProgrammeCheckinAppointments(appointmentIds: string[]) {
  return useQuery({
    queryKey: ["chronic-checkin-appointments", ...appointmentIds.slice().sort()],
    enabled: appointmentIds.length > 0,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("appointments")
        .select("id, status, scheduled_for, completed_at, clinician:profiles!appointments_clinician_id_fkey(full_name)")
        .in("id", appointmentIds);
      if (error) throw error;
      return data as {
        id: string;
        status: string;
        scheduled_for: string;
        completed_at: string | null;
        clinician: { full_name: string | null } | null;
      }[];
    },
  });
}

/** Titration history (medication_dose_history) for a patient, optionally
 * scoped to a date window — the programme-end review shows only what
 * changed during the 12-week enrolment. */
export function useMedicationDoseHistory(
  patientId: string | null | undefined,
  window?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ["medication-dose-history", patientId, window?.from, window?.to],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("medication_dose_history")
        .select("*, medication:medications(drug_name)")
        .eq("patient_id", patientId as string)
        .order("created_at", { ascending: false });
      if (window) {
        query = query.gte("created_at", window.from).lte("created_at", window.to);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as (MedicationDoseHistoryRow & { medication: { drug_name: string } | null })[];
    },
  });
}
