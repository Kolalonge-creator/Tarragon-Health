import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type EmergencyAccessGrant = {
  id: string;
  requesterId: string;
  requesterName: string | null;
  patientId: string;
  patientName: string | null;
  patientOrgName: string | null;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  endedAt: string | null;
  reviewStatus: "pending_review" | "reviewed_ok" | "reviewed_concern";
  reviewedByName: string | null;
  reviewNote: string | null;
  isOwnRequest: boolean;
};

const SELECT = `
  id, requester_id, patient_id, reason, granted_at, expires_at, ended_at, review_status, review_note,
  requester:profiles!emergency_record_access_grants_requester_id_fkey(full_name),
  patient:profiles!emergency_record_access_grants_patient_id_fkey(full_name),
  patient_org:organisations!emergency_record_access_grants_patient_org_id_fkey(name),
  reviewer:profiles!emergency_record_access_grants_reviewed_by_fkey(full_name)
`;

function shape(
  row: Record<string, unknown>,
  userId: string
): EmergencyAccessGrant {
  const requester = row.requester as { full_name: string | null } | null;
  const patient = row.patient as { full_name: string | null } | null;
  const patientOrg = row.patient_org as { name: string | null } | null;
  const reviewer = row.reviewer as { full_name: string | null } | null;
  return {
    id: row.id as string,
    requesterId: row.requester_id as string,
    requesterName: requester?.full_name ?? null,
    patientId: row.patient_id as string,
    patientName: patient?.full_name ?? null,
    patientOrgName: patientOrg?.name ?? null,
    reason: row.reason as string,
    grantedAt: row.granted_at as string,
    expiresAt: row.expires_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    reviewStatus: row.review_status as EmergencyAccessGrant["reviewStatus"],
    reviewedByName: reviewer?.full_name ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
    isOwnRequest: row.requester_id === userId,
  };
}

/**
 * Grants awaiting review. RLS on emergency_record_access_grants already
 * scopes this to the caller's own requests plus, for a clinical director,
 * every request against their own organisation's patients — the same
 * "reviewer must be the patient's home-org director" boundary
 * review_emergency_record_access() enforces server-side.
 */
export function usePendingEmergencyAccessReviews() {
  return useQuery({
    queryKey: ["emergency-access", "pending"],
    queryFn: async (): Promise<EmergencyAccessGrant[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("emergency_record_access_grants")
        .select(SELECT)
        .eq("review_status", "pending_review")
        .order("granted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => shape(row as Record<string, unknown>, user.id));
    },
  });
}

export function useEmergencyAccessHistory() {
  return useQuery({
    queryKey: ["emergency-access", "history"],
    queryFn: async (): Promise<EmergencyAccessGrant[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("emergency_record_access_grants")
        .select(SELECT)
        .neq("review_status", "pending_review")
        .order("reviewed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row) => shape(row as Record<string, unknown>, user.id));
    },
  });
}
