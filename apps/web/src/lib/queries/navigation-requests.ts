import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { CreateNavigationRequestInput } from "@/lib/validation/navigation-requests";

export type NavigationRequestWithDetails = Tables<"navigation_requests"> & {
  patient: { full_name: string | null } | null;
  assigned_staff: { full_name: string | null } | null;
};

const NAVIGATION_REQUEST_SELECT =
  "*, patient:profiles!navigation_requests_patient_id_fkey(full_name), assigned_staff:profiles!navigation_requests_assigned_to_fkey(full_name)";

/** A patient's own navigation requests, most recent first (75.4/75.18). */
export function useMyNavigationRequests(patientId: string) {
  return useQuery({
    queryKey: ["navigation-requests", "patient", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("navigation_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"navigation_requests">[];
    },
    enabled: !!patientId,
  });
}

/** Org-wide navigator worklist -- open/in-progress requests first, most
 * recently created first within each. Resolved requests are fetched too
 * (needed for the "Resolved" stat tile and a short history) but the UI is
 * expected to keep the default view scoped to non-resolved work. */
export function useOrgNavigationRequests() {
  return useQuery({
    queryKey: ["navigation-requests", "org-worklist"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("navigation_requests")
        .select(NAVIGATION_REQUEST_SELECT)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as NavigationRequestWithDetails[];
    },
    refetchInterval: 60_000,
  });
}

/** Logs a new "I need help" request (75.4) via create_navigation_request --
 * organisation_id/patient_id/classification are all server-derived by the
 * BEFORE INSERT trigger the RPC's own insert still runs through; the RPC
 * wrapper exists only because organisation_id has no client-visible default,
 * which a direct table insert from here would otherwise require. */
export function useCreateNavigationRequest(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateNavigationRequestInput) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("create_navigation_request", {
        p_category: input.category,
        p_description: input.description,
        p_is_complaint: input.isComplaint,
        p_patient_id: patientId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
    },
  });
}

/** Claims an unassigned request for the current navigator. */
export function useAssignNavigationRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("navigation_requests")
        .update({ assigned_to: user.id })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
    },
  });
}

/** Toggles urgent/waiting_on_patient/etc without resolving -- lightweight
 * triage moves a navigator makes while working the queue. */
export function useUpdateNavigationRequestStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      status,
      isUrgent,
    }: {
      requestId: string;
      status?: Tables<"navigation_requests">["status"];
      isUrgent?: boolean;
    }) => {
      const supabase = createClient();
      const patch: Partial<Pick<Tables<"navigation_requests">, "status" | "is_urgent">> = {
        ...(status ? { status } : {}),
        ...(isUrgent !== undefined ? { is_urgent: isUrgent } : {}),
      };
      const { error } = await supabase.from("navigation_requests").update(patch).eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
    },
  });
}

/** Resolves a request with a required note (75.16/75.18's closed loop --
 * the DB trigger stamps resolved_by/resolved_at and fires the patient
 * notification; this just supplies status + note). */
export function useResolveNavigationRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, resolutionNote }: { requestId: string; resolutionNote: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("navigation_requests")
        .update({ status: "resolved", resolution_note: resolutionNote })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
    },
  });
}

/** 75.5 smart-routing hand-off: moves a clinical-flagged request into the
 * existing care_messages channel instead of letting a non-clinical
 * navigator answer it. Reuses start_care_thread (care-messages.ts's own
 * RPC) rather than any new escalation machinery. */
export function useHandOffToCareTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      patientId,
      category,
    }: {
      requestId: string;
      patientId: string;
      category: string;
    }) => {
      const supabase = createClient();
      const { data: threadId, error: threadError } = await supabase.rpc("start_care_thread", {
        p_subject: `Navigation request needs clinical input (${category})`,
        p_body:
          "A patient support request looked like it might need clinical input, so a navigator handed it to your care team.",
        p_patient_id: patientId,
      });
      if (threadError) throw threadError;

      const { error } = await supabase
        .from("navigation_requests")
        .update({ care_message_thread_id: threadId, status: "waiting_on_provider" })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["care-threads"] });
    },
  });
}

/** Patient closed-loop feedback (75.17/75.18), gated server-side to the
 * request's own patient once it is resolved. */
export function useSubmitNavigationRequestFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      rating,
      comment,
    }: {
      requestId: string;
      rating: number;
      comment?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_navigation_request_feedback", {
        p_request_id: requestId,
        p_rating: rating,
        ...(comment ? { p_comment: comment } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["navigation-requests"] });
    },
  });
}
