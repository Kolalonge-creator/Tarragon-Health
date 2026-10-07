import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type TherapyProvider = Tables<"therapy_directory">;
/** Track E 8.16: commission_kobo is not readable by the patient or a clinician (column grant); explicit columns only. */
export type TherapySession = Omit<Tables<"therapy_sessions">, "commission_kobo">;
export const THERAPY_SESSION_SAFE_COLUMNS =
  "id, organisation_id, patient_id, provider_id, status, modality, requested_at, scheduled_for, completed_at, cancelled_at, cancelled_reason, fee_kobo, payment_provider_ref, approved_by, approved_at, clinician_alert_id, patient_note, created_at, updated_at";

/**
 * The verified therapy network.
 *
 * Reads public.therapy_directory, a VIEW, not specialist_providers itself:
 * the underlying table carries contact details, licence numbers and Tarragon's
 * commission rate, none of which is a patient's business. The view is also
 * where "verified, in date, and active" is enforced, so an unverified
 * practitioner cannot appear here by a caller forgetting a filter.
 *
 * ORDERING IS A PLAIN, PATIENT-CONTROLLED SORT AND MUST STAY ONE.
 * This platform has a standing guardrail against a specialist matching or
 * ranking engine. Listing practitioners and letting someone filter by what
 * they need is not that; scoring them, or ordering by anything Tarragon earns,
 * would be. Never order by commission, and never introduce a "recommended"
 * or "best match" ordering here without an explicit founder decision.
 */
export const therapyKeys = {
  directory: ["therapy-directory"] as const,
  mySessions: ["therapy-sessions", "mine"] as const,
};

export function useTherapyDirectory(filters?: {
  specialistType?: Enums<"specialist_type">;
  state?: string;
  telemedicineOnly?: boolean;
}) {
  return useQuery({
    queryKey: [...therapyKeys.directory, filters ?? {}],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("therapy_directory").select("*");
      if (filters?.specialistType) query = query.eq("specialist_type", filters.specialistType);
      if (filters?.state) query = query.eq("state", filters.state);
      if (filters?.telemedicineOnly) query = query.eq("supports_telemedicine", true);
      // Alphabetical: the one ordering that cannot be accused of steering.
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data as TherapyProvider[];
    },
  });
}

export function useMyTherapySessions() {
  return useQuery({
    queryKey: therapyKeys.mySessions,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("therapy_sessions")
        .select(`${THERAPY_SESSION_SAFE_COLUMNS}, provider:therapy_directory!inner(name, specialist_type)`)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Request a session.
 *
 * Everything that could go wrong clinically is refused by the database, not
 * here — private.enforce_therapy_session_rules checks that the practitioner is
 * active and in date, that they offer the modality asked for, that psychiatry
 * waits for a doctor, and, most importantly, that the patient does not have an
 * open crisis alert. That last rule is why this deliberately does NOT
 * pre-filter the button out of the UI on a crisis: a person in crisis should
 * see the reason they are being redirected to urgent help, not a silently
 * missing button.
 *
 * The error messages are written to be shown to the patient verbatim.
 */
export function useRequestTherapySession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      providerId,
      feeKobo,
      modality,
      patientNote,
    }: {
      organisationId: string;
      patientId: string;
      providerId: string;
      feeKobo: number;
      modality: Enums<"therapy_modality">;
      patientNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("therapy_sessions").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        provider_id: providerId,
        // Snapshotted at request time so a practitioner changing their rate
        // cannot change what this person was quoted. commission_kobo is
        // computed by the trigger from the provider's own rate; the client
        // never sends it and could not be trusted to.
        fee_kobo: feeKobo,
        modality,
        patient_note: patientNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: therapyKeys.mySessions });
    },
  });
}
