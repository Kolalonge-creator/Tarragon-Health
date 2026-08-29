import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type {
  LogVaccinationInput,
  ReportVaccinationAdverseEventInput,
} from "@/lib/validation/vaccination";
import type { VaccinationNonAdministration } from "@/lib/rules/vaccination-status";

export type VaccinationCatalogEntry = Tables<"vaccination_catalog">;
export type VaccinationRecord = Tables<"vaccination_records">;
export type VaccinationSchedule = Tables<"vaccination_schedules">;
export type VaccinationAdverseEvent = Tables<"vaccination_adverse_events">;

const CERTIFICATE_BUCKET = "vaccination-certificates";

export function vaccinationRecordsKey(patientId: string) {
  return ["vaccination-records", patientId];
}

export function vaccinationSchedulesKey(patientId: string) {
  return ["vaccination-schedules", patientId];
}

export function vaccinationNonAdministrationsKey(patientId: string) {
  return ["vaccination-non-administrations", patientId];
}

export function vaccinationAdverseEventsKey(patientId: string) {
  return ["vaccination-adverse-events", patientId];
}

/** Global reference catalogue — same for every patient, no patientId scoping. */
export function useVaccinationCatalog() {
  return useQuery({
    queryKey: ["vaccination-catalog"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_catalog")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as VaccinationCatalogEntry[];
    },
  });
}

export function useVaccinationRecords(patientId: string) {
  return useQuery({
    queryKey: vaccinationRecordsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_records")
        .select("*")
        .eq("profile_id", patientId)
        .order("date_administered", { ascending: true });
      if (error) throw error;
      return data as VaccinationRecord[];
    },
    enabled: !!patientId,
  });
}

/**
 * The patient's active (pending/booked) persisted schedule rows — the
 * reminder-bearing projection of the due/overdue engine. Used to surface the
 * concrete "next dose due {date}" call-to-action (Priority #4).
 */
export function useVaccinationSchedules(patientId: string) {
  return useQuery({
    queryKey: vaccinationSchedulesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_schedules")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["pending", "booked"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as VaccinationSchedule[];
    },
    enabled: !!patientId,
  });
}

/**
 * The patient's recorded declines/contraindications (spec §43.3) — every
 * vaccination_schedules row (any status) that carries a
 * non_administration_reason, keyed for
 * applyNonAdministrationOverrides to overlay onto computeVaccinationStatuses.
 */
export function useVaccinationNonAdministrations(patientId: string) {
  return useQuery({
    queryKey: vaccinationNonAdministrationsKey(patientId),
    queryFn: async (): Promise<VaccinationNonAdministration[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_schedules")
        .select("vaccination_catalog_id, non_administration_reason")
        .eq("patient_id", patientId)
        .not("non_administration_reason", "is", null);
      if (error) throw error;
      return (data ?? []) as VaccinationNonAdministration[];
    },
    enabled: !!patientId,
  });
}

/**
 * Self-reported entries are explicitly in scope (spec §3.5) — this writes
 * through the patient's own RLS-scoped session, same as vitals_readings.
 * Returns the new record id so the caller can immediately attach a
 * certificate to it (see useAttachVaccinationCertificate).
 */
export function useLogVaccination() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogVaccinationInput & { patientId: string }): Promise<string> => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { patientId, provider, booking_request_id, ...rest } = input;
      const { data, error } = await supabase
        .from("vaccination_records")
        .insert({
          ...rest,
          profile_id: patientId,
          organisation_id: profile.organisation_id,
          provider: provider || null,
          booking_request_id: booking_request_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vaccinationRecordsKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: vaccinationSchedulesKey(variables.patientId) });
    },
  });
}

/**
 * Uploads the physical certificate the patient was handed at the vaccination
 * centre and moves the record into 'pending_verification' for the Tarragon
 * care team to review. The image goes to a private storage bucket under the
 * caller's own uid folder (storage RLS), and is only ever viewed by staff via
 * a short-lived signed URL minted server-side — never a public URL.
 *
 * All writes run through the patient's own RLS-scoped session; the
 * enforce_vaccination_verification trigger keeps this transition to
 * 'pending_verification' (a patient can attach proof, never self-verify).
 */
export function useAttachVaccinationCertificate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      recordId: string;
      patientId: string;
      file: File;
    }): Promise<void> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const ext = input.file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/${input.recordId}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(CERTIFICATE_BUCKET)
        .upload(path, input.file, { upsert: true, contentType: input.file.type });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("vaccination_records")
        .update({
          physical_certificate_path: path,
          verification_status: "pending_verification",
        })
        .eq("id", input.recordId);
      if (updateError) throw updateError;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vaccinationRecordsKey(variables.patientId) });
    },
  });
}

/** A patient's own reported reactions (spec §43.11), newest first. */
export function useVaccinationAdverseEvents(patientId: string) {
  return useQuery({
    queryKey: vaccinationAdverseEventsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_adverse_events")
        .select("*")
        .eq("patient_id", patientId)
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as VaccinationAdverseEvent[];
    },
    enabled: !!patientId,
  });
}

/**
 * Reports a reaction/symptom following a logged dose (spec §43.11). Writes
 * through the caller's own RLS-scoped session; organisation_id and
 * reported_by are never trusted from the client —
 * private.enforce_vaccination_adverse_event_report stamps reported_by and
 * cross-checks the dose actually belongs to patientId, and a significant
 * report (severe, or any allergic-reaction symptom) routes itself into the
 * clinician alert inbox via a database trigger, not from here.
 */
export function useReportVaccinationAdverseEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReportVaccinationAdverseEventInput): Promise<void> => {
      const supabase = createClient();
      const { data: patient, error: patientError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (patientError) throw patientError;
      if (!patient?.organisation_id) throw new Error("This patient has no organisation on file");

      const { error } = await supabase.from("vaccination_adverse_events").insert({
        organisation_id: patient.organisation_id,
        patient_id: input.patientId,
        vaccination_record_id: input.vaccinationRecordId,
        symptoms: input.symptoms,
        severity: input.severity,
        description: input.description ?? null,
        onset_at: input.onsetAt ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vaccinationAdverseEventsKey(variables.patientId) });
    },
  });
}
