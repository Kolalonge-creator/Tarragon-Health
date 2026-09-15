import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PrescriptionRenewalRequest = Tables<"prescription_renewal_requests">;

export type PrescriptionRenewalRequestWithPatient = PrescriptionRenewalRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  medication: { drug_name: string; dose: string | null } | null;
};

export const prescriptionRenewalKeys = {
  forMedication: (medicationId: string) =>
    ["prescription-renewal-requests", "medication", medicationId] as const,
  org: ["prescription-renewal-requests", "org"] as const,
};

/** The most recent open request (submitted/in_review) for one medication, if
 * any — used to swap the "Request renewal" button for a status line and to
 * respect the DB's one-open-request-per-medication constraint client-side
 * too, before the round trip. */
export function useMedicationRenewalRequest(medicationId: string) {
  return useQuery({
    queryKey: prescriptionRenewalKeys.forMedication(medicationId),
    enabled: !!medicationId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("prescription_renewal_requests")
        .select("*")
        .eq("medication_id", medicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PrescriptionRenewalRequest | null;
    },
  });
}

/** Patient requests a renewal — prescription_renewal_requests_enforce_credit
 * (the DB trigger) checks plan access OR redeems a credit, or rejects the
 * insert outright. */
export function useRequestPrescriptionRenewal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      medicationId,
      patientNote,
    }: {
      patientId: string;
      organisationId: string;
      medicationId: string;
      patientNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("prescription_renewal_requests").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        medication_id: medicationId,
        patient_note: patientNote || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: prescriptionRenewalKeys.forMedication(variables.medicationId),
      });
    },
  });
}

/** Doctor-side worklist. */
export function useOrgPrescriptionRenewalRequests() {
  return useQuery({
    queryKey: prescriptionRenewalKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("prescription_renewal_requests")
        .select(
          "*, patient:profiles!prescription_renewal_requests_patient_id_fkey(full_name, patient_number), medication:medications!prescription_renewal_requests_medication_id_fkey(drug_name, dose)"
        )
        .in("status", ["submitted", "in_review"])
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as PrescriptionRenewalRequestWithPatient[];
    },
  });
}

/** Claim a request for review — same visible-state-change purpose as the
 * other worklists' "Start review". */
export function useMarkRenewalInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("prescription_renewal_requests")
        .update({ status: "in_review" })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prescriptionRenewalKeys.org });
    },
  });
}

/** Doctor approves or declines — stamps reviewed_by/reviewed_at server-side
 * (private.stamp_prescription_renewal_review). Approving does NOT write to
 * medications itself — the doctor still issues the actual renewed
 * prescription through the existing chart tools; this only records the
 * review decision. */
export function useDecideRenewalRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      decision,
      doctorNote,
    }: {
      requestId: string;
      decision: "approved" | "declined";
      doctorNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("prescription_renewal_requests")
        .update({ status: decision, doctor_note: doctorNote || null })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prescriptionRenewalKeys.org });
    },
  });
}
