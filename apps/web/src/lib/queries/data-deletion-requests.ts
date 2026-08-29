"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { DataDeletionScope } from "@/lib/device-data-deletion-labels";

export type DataDeletionRequest = Tables<"data_deletion_requests">;

export type DataDeletionRequestWithPatient = DataDeletionRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export type DataRetentionPolicy = Tables<"data_retention_policies">;

/** The live retention policy per data category — plain, admin-authored text,
 * readable by any authenticated user (see data_retention_policies_select).
 * Low-priority per spec 55.19: shown as a short transparency note, not a
 * dedicated page. */
export function useCurrentRetentionPolicies() {
  return useQuery({
    queryKey: ["data-retention-policies", "current"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_retention_policies")
        .select("*")
        .eq("is_current", true)
        .order("data_category");
      if (error) throw error;
      return data as DataRetentionPolicy[];
    },
  });
}

function patientKey(patientId: string) {
  return ["data-deletion-requests", "patient", patientId];
}
const orgKey = ["data-deletion-requests", "org"];

/** A patient's own device-data deletion requests, newest first — 55.19. */
export function usePatientDeletionRequests(patientId: string) {
  return useQuery({
    queryKey: patientKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_deletion_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DataDeletionRequest[];
    },
    enabled: !!patientId,
  });
}

/** Submits a new deletion request for the patient's own account. RLS
 * (data_deletion_requests_insert) requires patient_id = auth.uid(), so this
 * only ever works for the currently authenticated patient, not someone they
 * support. */
export function useSubmitDeletionRequest(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: DataDeletionScope; reason: string }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("Could not find your organisation — please contact support.");
      }

      const reason = input.reason.trim();
      const { error } = await supabase.from("data_deletion_requests").insert({
        organisation_id: profile.organisation_id,
        patient_id: patientId,
        scope: input.scope,
        reason: reason.length > 0 ? reason : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientKey(patientId) });
    },
  });
}

/** Every deletion request in the given org (staff worklist) — RLS
 * (data_deletion_requests_select) already scopes reads to the caller's own
 * org via private.is_org_staff; the explicit filter here just matches the
 * organisationId the server-resolved page passed down, newest requested
 * first. */
export function useOrgDeletionRequests(organisationId: string | null) {
  return useQuery({
    queryKey: [...orgKey, organisationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_deletion_requests")
        .select(
          "*, patient:profiles!data_deletion_requests_patient_id_fkey(full_name, patient_number)"
        )
        .eq("organisation_id", organisationId as string)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as DataDeletionRequestWithPatient[];
    },
    enabled: !!organisationId,
  });
}

/** Processes a request via the bounded, audited RPC — deletes
 * wearable_readings always, plus connections/devices depending on scope.
 * Never touches vitals_readings (see execute_wearable_data_deletion()). */
export function useProcessDeletionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("execute_wearable_data_deletion", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKey });
    },
  });
}

/** Rejects a request staff decide not to action — a plain UPDATE (staff
 * already hold column-level UPDATE grant per RLS), not the deletion RPC. */
export function useRejectDeletionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("data_deletion_requests")
        .update({
          status: "rejected",
          rejection_reason: reason.trim(),
          processed_by: user?.id ?? null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKey });
    },
  });
}
