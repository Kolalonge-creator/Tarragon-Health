import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AsyncConsult = Tables<"async_consults">;

export type AsyncConsultWithAnswerer = AsyncConsult & {
  answerer: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
};

export type AsyncConsultWithPatient = AsyncConsult & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const asyncConsultKeys = {
  mine: (patientId: string) => ["async-consults", "mine", patientId] as const,
  org: ["async-consults", "org"] as const,
};

/**
 * `answered_by` used to be embedded directly via
 * `clinical_staff!async_consults_answered_by_fkey(...)` — a PostgREST
 * embedded join, which resolves against `clinical_staff`'s OWN RLS, not this
 * query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own answered
 * consult. Fetching the answerer separately from
 * public.clinical_staff_directory (the safe-column view every patient-facing
 * clinical_staff read now uses) restores the same attribution without
 * reopening the column-exposure gap that migration fixed.
 */
async function fetchAnswerers(
  supabase: ReturnType<typeof createClient>,
  answererIds: string[]
): Promise<Map<string, NonNullable<AsyncConsultWithAnswerer["answerer"]>>> {
  const answererById = new Map<string, NonNullable<AsyncConsultWithAnswerer["answerer"]>>();
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

/** The patient's own consult history, newest first — RLS returns only theirs. */
export function useMyAsyncConsults(patientId: string) {
  return useQuery({
    queryKey: asyncConsultKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("async_consults")
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
      })) as AsyncConsultWithAnswerer[];
    },
  });
}

/** Patient submits a new question. organisation_id is pinned by RLS to their own org. */
export function useSubmitAsyncConsult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      category,
      question,
      durationNote,
    }: {
      patientId: string;
      organisationId: string;
      category: string;
      question: string;
      durationNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("async_consults").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        category,
        question,
        duration_note: durationNote || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: asyncConsultKeys.mine(variables.patientId) });
    },
  });
}

/** Doctor-side worklist: everything awaiting an answer, soonest SLA first. */
export function useOrgAsyncConsults() {
  return useQuery({
    queryKey: asyncConsultKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("async_consults")
        .select(
          "*, patient:profiles!async_consults_patient_id_fkey(full_name, patient_number)"
        )
        .in("status", ["submitted", "in_review"])
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as AsyncConsultWithPatient[];
    },
  });
}

/** Claim a consult for review (visible state change so two doctors don't double-answer). */
export function useMarkConsultInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (consultId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("async_consults")
        .update({ status: "in_review" })
        .eq("id", consultId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: asyncConsultKeys.org });
    },
  });
}
