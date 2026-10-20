import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import {
  secondOpinionWorklistSchema,
  SECOND_OPINION_DOCUMENT_BUCKET,
  SECOND_OPINION_DOCUMENT_EXT,
} from "@/lib/validation/second-opinion";

export type SecondOpinionRequest = Tables<"second_opinion_requests">;

export type SecondOpinionRequestWithAnswerer = SecondOpinionRequest & {
  answerer: {
    id: string;
    full_name: string;
  } | null;
};

export type { SecondOpinionWorklistItem } from "@/lib/validation/second-opinion";

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
    .select("id, full_name")
    .in("id", answererIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    answererById.set(row.id, {
      id: row.id,
      full_name: row.full_name ?? "",
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
      sharedLabResultIds = [],
      files = [],
    }: {
      patientId: string;
      organisationId: string;
      existingDiagnosisOrResult: string;
      sourceDescription?: string;
      specificQuestion?: string;
      /** Released lab results the patient chose to show the doctor; the database re-checks every id. */
      sharedLabResultIds?: string[];
      /** Outside reports (PDF or photo) to upload after the request exists; the caller has already checked type, size and count. */
      files?: File[];
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("second_opinion_requests")
        .insert({
          patient_id: patientId,
          organisation_id: organisationId,
          existing_diagnosis_or_result: existingDiagnosisOrResult,
          source_description: sourceDescription || null,
          specific_question: specificQuestion || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      // The request (and its redeemed credit) already exist, so nothing below may surface as a failed submit: the form would
      // keep its text and a second click would spend a second credit. Report problems as a warning on a successful send.
      let resultsAttached = true;
      if (sharedLabResultIds.length > 0) {
        const { error: shareError } = await supabase.rpc("share_results_with_second_opinion", {
          p_request: data.id,
          p_lab_results: sharedLabResultIds,
        });
        if (shareError) resultsAttached = false;
      }
      let filesFailed = 0;
      for (const file of files) {
        const ext = SECOND_OPINION_DOCUMENT_EXT[file.type as keyof typeof SECOND_OPINION_DOCUMENT_EXT];
        if (!ext) {
          filesFailed += 1;
          continue;
        }
        const path = `${patientId}/${data.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(SECOND_OPINION_DOCUMENT_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          filesFailed += 1;
          continue;
        }
        const { error: attachError } = await supabase.rpc("attach_second_opinion_document", {
          p_request: data.id,
          p_path: path,
          p_mime: file.type,
          p_bytes: file.size,
        });
        if (attachError) filesFailed += 1;
      }
      return { resultsAttached, filesFailed };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.mine(variables.patientId) });
    },
  });
}

/** The referral a doctor recommended with the answer (a draft until the patient accepts). Read under the patient's own RLS. */
export function useSecondOpinionReferral(referralId: string | null) {
  return useQuery({
    queryKey: ["second-opinion-referral", referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("specialist_referrals")
        .select("id, status, specialist_type, urgency, referral_reason")
        .eq("id", referralId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Patient accepts the recommended referral; the existing consent trigger stamps patient_consent_at. */
export function useAcceptSecondOpinionReferral(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await createClient().rpc("accept_second_opinion_referral", { p_request: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["second-opinion-referral"] });
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.mine(patientId) });
    },
  });
}

/** Doctor-side worklist. */
export function useOrgSecondOpinionRequests() {
  return useQuery({
    queryKey: secondOpinionKeys.org,
    queryFn: async () => {
      // Through a function, not the table: a request creates no care-team tie, so the S39b tied SELECT would hide it from a doctor
      // who has never met the patient.
      const { data, error } = await createClient().rpc("list_second_opinion_worklist");
      if (error) throw error;
      return secondOpinionWorklistSchema.parse(data ?? []);
    },
  });
}

/** Claim a request for review — same visible-state-change purpose as
 * useMarkConsultInReview, so two doctors don't work the same request. */
export function useMarkSecondOpinionInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await createClient().rpc("start_second_opinion_review", { p_request: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.org });
    },
  });
}
