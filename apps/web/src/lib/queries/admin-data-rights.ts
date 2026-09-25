import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, TablesUpdate } from "@tarragon/shared";

type PatientSummary = { full_name: string | null; patient_number: string | null } | null;

export type AdminDataExportRequest = Tables<"data_export_requests"> & { patient: PatientSummary };
export type AdminDataDeletionRequest = Tables<"data_deletion_requests"> & { patient: PatientSummary };
export type AdminDataCorrectionRequest = Tables<"data_correction_requests"> & {
  patient: PatientSummary;
};

const EXPORT_KEY = ["admin", "data-export-requests"];
const DELETION_KEY = ["admin", "data-deletion-requests-dsar"];
const CORRECTION_KEY = ["admin", "data-correction-requests"];

/**
 * Admin-facing DSAR review queues, docs spec §87.7-§87.11. The three
 * request tables (data_export_requests / data_deletion_requests /
 * data_correction_requests, migrations 20260829223506 / 20260830001845 /
 * 20260907130511) shipped with a patient-facing submission form
 * (Privacy Centre's DataRightsPanel) and full RLS/attribution triggers
 * allowing an admin to review them, but no UI anywhere ever called that
 * RLS-permitted update — a patient's request had nowhere to go. This file
 * is the missing other half: an admin queue to actually review, decide, and
 * (for export/deletion) mark work as fulfilled/completed once done. It does
 * not bypass RLS or add a service-role shortcut — every query/mutation here
 * runs through the caller's own RLS-active client, same as the patient-side
 * hooks in data-rights.ts; a non-admin caller simply gets zero rows back
 * (data_export_requests/data_deletion_requests) or only their own org's rows
 * (data_correction_requests, which private.is_org_staff also admits admin
 * into) rather than an error, matching this app's existing RLS-driven
 * fetch-not-filter convention.
 */
export function useAdminExportRequests() {
  return useQuery({
    queryKey: EXPORT_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_export_requests")
        .select("*, patient:profiles!data_export_requests_patient_id_fkey(full_name, patient_number)")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AdminDataExportRequest[];
    },
  });
}

export function useAdminDeletionRequests() {
  return useQuery({
    queryKey: DELETION_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_deletion_requests")
        .select(
          "*, patient:profiles!data_deletion_requests_patient_id_fkey(full_name, patient_number)"
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AdminDataDeletionRequest[];
    },
  });
}

export function useAdminCorrectionRequests() {
  return useQuery({
    queryKey: CORRECTION_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_correction_requests")
        .select(
          "*, patient:profiles!data_correction_requests_patient_id_fkey(full_name, patient_number)"
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AdminDataCorrectionRequest[];
    },
  });
}

/**
 * Every mutation below is a plain UPDATE — private.enforce_data_*_request_
 * attribution stamps reviewed_by/reviewed_at (and completed_by/completed_at,
 * fulfilled_by/fulfilled_at) server-side and refuses a non-admin/non-staff
 * caller; this layer only supplies the fields a human reviewer actually
 * decides (status + notes). Table CHECK constraints (see the migrations)
 * require a note on denial and on partial approval/applied/completed — the
 * UI below collects those before enabling the action, but the DB is the
 * real gate.
 */
/**
 * Every update payload below is built by only setting the keys the caller
 * actually supplied, never defaulting an omitted field to '' / null / [] —
 * a status-only transition (e.g. "Mark fulfilled" after an earlier "Deny"
 * was reconsidered, or "Mark completed" after "approved_partial") must not
 * silently wipe a decision_note/blocked_reason a previous review step
 * already recorded. Found in review: the first version of this file
 * unconditionally resent every optional column on every transition, so
 * completing a partially-approved deletion request erased the exact
 * "what couldn't be deleted and why" text the column exists to preserve.
 */
export function useReviewExportRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      status: "under_review" | "fulfilled" | "denied";
      decisionNote?: string;
    }) => {
      const supabase = createClient();
      const update: TablesUpdate<"data_export_requests"> = { status: input.status };
      if (input.decisionNote !== undefined) update.decision_note = input.decisionNote || null;
      const { error } = await supabase
        .from("data_export_requests")
        .update(update)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPORT_KEY });
    },
  });
}

export function useReviewDeletionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      status: "under_review" | "approved_full" | "approved_partial" | "denied" | "completed";
      decisionNote?: string;
      blockedCategories?: string[];
      blockedReason?: string;
    }) => {
      const supabase = createClient();
      const update: TablesUpdate<"data_deletion_requests"> = { status: input.status };
      if (input.decisionNote !== undefined) update.decision_note = input.decisionNote || null;
      if (input.blockedCategories !== undefined) update.blocked_categories = input.blockedCategories;
      if (input.blockedReason !== undefined) update.blocked_reason = input.blockedReason || null;
      const { error } = await supabase
        .from("data_deletion_requests")
        .update(update)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DELETION_KEY });
    },
  });
}

export function useReviewCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      status: "under_review" | "approved" | "applied" | "denied";
      decisionNote?: string;
      resolutionNote?: string;
    }) => {
      const supabase = createClient();
      const update: TablesUpdate<"data_correction_requests"> = { status: input.status };
      if (input.decisionNote !== undefined) update.decision_note = input.decisionNote || null;
      if (input.resolutionNote !== undefined) update.resolution_note = input.resolutionNote || null;
      const { error } = await supabase
        .from("data_correction_requests")
        .update(update)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CORRECTION_KEY });
    },
  });
}
