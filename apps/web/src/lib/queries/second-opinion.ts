import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SecondOpinionRequest = Tables<"second_opinion_requests">;

export type SecondOpinionRequestWithAnswerer = SecondOpinionRequest & {
  answerer: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
};

export type SecondOpinionRequestWithPatient = SecondOpinionRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const secondOpinionKeys = {
  mine: (patientId: string) => ["second-opinion-requests", "mine", patientId] as const,
  org: ["second-opinion-requests", "org"] as const,
};

/**
 * `answered_by` used to be embedded directly via
 * `clinical_staff!second_opinion_requests_answered_by_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN RLS,
 * not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own answered
 * request. Fetching the answerer separately from
 * public.clinical_staff_directory (the safe-column view every patient-facing
 * clinical_staff read now uses) restores the same attribution without
 * reopening the column-exposure gap that migration fixed.
 */
async function fetchAnswerers(
  supabase: ReturnType<typeof createClient>,
  answererIds: string[]
): Promise<Map<string, NonNullable<SecondOpinionRequestWithAnswerer["answerer"]>>> {
  const answererById = new Map<string, NonNullable<SecondOpinionRequestWithAnswerer["answerer"]>>();
  if (answererIds.length === 0) return answererById;
  const { data, error } = await supabase
    .from("clinical_staff_directory")
    .select("id, full_name, credential_type, credential_number")
    .in("id", answererIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    answererById.set(row.id, {
      full_name: row.full_name ?? "",
      credential_type: row.credential_type,
      credential_number: row.credential_number,
    });
  }
  return answererById;
}

/** The patient's own request history, newest first — mirrors
 * useMyAsyncConsults (async-consults.ts). */
export function useMySecondOpinionRequests(patientId: string) {
  return useQuery({
    queryKey: secondOpinionKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("second_opinion_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;

      const rows = data ?? [];
      const answererIds = Array.from(
        new Set(rows.map((row) => row.answered_by).filter((id): id is string => !!id))
      );
      const answererById = await fetchAnswerers(supabase, answererIds);

      return rows.map((row) => ({
        ...row,
        answerer: row.answered_by ? (answererById.get(row.answered_by) ?? null) : null,
      })) as SecondOpinionRequestWithAnswerer[];
    },
  });
}

/** Patient submits a new request — second_opinion_requests_enforce_credit
 * (the DB trigger) redeems one second_opinion_credit or rejects the insert
 * outright; there's no plan-covered bypass for this item. */
export function useSubmitSecondOpinionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      existingDiagnosisOrResult,
      sourceDescription,
      specificQuestion,
    }: {
      patientId: string;
      organisationId: string;
      existingDiagnosisOrResult: string;
      sourceDescription?: string;
      specificQuestion?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("second_opinion_requests").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        existing_diagnosis_or_result: existingDiagnosisOrResult,
        source_description: sourceDescription || null,
        specific_question: specificQuestion || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.mine(variables.patientId) });
    },
  });
}

/** Doctor-side worklist. */
export function useOrgSecondOpinionRequests() {
  return useQuery({
    queryKey: secondOpinionKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("second_opinion_requests")
        .select(
          "*, patient:profiles!second_opinion_requests_patient_id_fkey(full_name, patient_number)"
        )
        .in("status", ["submitted", "in_review"])
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as SecondOpinionRequestWithPatient[];
    },
  });
}

/** Claim a request for review — same visible-state-change purpose as
 * useMarkConsultInReview, so two doctors don't work the same request. */
export function useMarkSecondOpinionInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("second_opinion_requests")
        .update({ status: "in_review" })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.org });
    },
  });
}
