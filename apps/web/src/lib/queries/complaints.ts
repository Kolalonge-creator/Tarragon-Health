import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type Complaint = Tables<"complaints">;
export type ComplaintStatus = Enums<"complaint_status">;

export const complaintKeys = {
  mine: (patientId: string) => ["complaints", "mine", patientId] as const,
  queue: () => ["complaints", "queue"] as const,
  detail: (complaintId: string) => ["complaints", "detail", complaintId] as const,
};

const COMPLAINT_SELECT = "*, patient:profiles!complaints_patient_id_fkey(full_name)";

export type ComplaintWithPatient = Complaint & { patient: { full_name: string | null } | null };

export function useMyComplaints(patientId: string) {
  return useQuery({
    queryKey: complaintKeys.mine(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("complaints")
        .select(COMPLAINT_SELECT)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ComplaintWithPatient[];
    },
  });
}

/** The governance queue — every complaint short of governance_review, oldest first (§24.16's "accountable owner" principle). */
export function useComplaintQueue() {
  return useQuery({
    queryKey: complaintKeys.queue(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("complaints")
        .select(COMPLAINT_SELECT)
        .neq("status", "governance_review")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ComplaintWithPatient[];
    },
    refetchInterval: 60_000,
  });
}

export function useComplaint(complaintId: string | undefined) {
  return useQuery({
    queryKey: complaintKeys.detail(complaintId ?? ""),
    enabled: !!complaintId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("complaints")
        .select(COMPLAINT_SELECT)
        .eq("id", complaintId as string)
        .single();
      if (error) throw error;
      return data as ComplaintWithPatient;
    },
  });
}

function invalidateComplaint(queryClient: ReturnType<typeof useQueryClient>, complaintId: string) {
  queryClient.invalidateQueries({ queryKey: complaintKeys.detail(complaintId) });
  queryClient.invalidateQueries({ queryKey: ["complaints"] });
}

/** §24.14's seven-stage transition RPC. */
export function useAdvanceComplaintStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { complaintId: string; to: ComplaintStatus; note?: string; assigneeId?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("advance_complaint_status", {
        p_complaint_id: input.complaintId,
        p_to: input.to,
        p_note: input.note,
        p_assignee_id: input.assigneeId,
      });
      if (error) throw error;
      return data as Complaint;
    },
    onSuccess: (_data, variables) => invalidateComplaint(queryClient, variables.complaintId),
  });
}

/** §24.15's "complaint indicating potential patient harm -> formal clinical incident" link. */
export function useEscalateComplaintToIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { complaintId: string; category: string; severity: string; description: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("escalate_complaint_to_incident", {
        p_complaint_id: input.complaintId,
        p_category: input.category,
        p_severity: input.severity,
        p_description: input.description,
      });
      if (error) throw error;
      return data as Complaint;
    },
    onSuccess: (_data, variables) => invalidateComplaint(queryClient, variables.complaintId),
  });
}
