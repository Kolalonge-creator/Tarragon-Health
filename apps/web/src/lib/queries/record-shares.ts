import { createClient } from "@/lib/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type RecordShareSection =
  | "vitals"
  | "medications"
  | "conditions"
  | "allergies"
  | "lab_results"
  | "vaccinations"
  | "emergency_info";

export const SHARE_SECTIONS: RecordShareSection[] = [
  "vitals",
  "medications",
  "conditions",
  "allergies",
  "lab_results",
  "vaccinations",
  "emergency_info",
];

export type RecordShare = {
  id: string;
  token: string;
  sections: RecordShareSection[];
  expires_at: string;
  is_active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export function useRecordShares(patientId: string) {
  return useQuery({
    queryKey: ["record-shares", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("record_shares")
        .select("id, token, sections, expires_at, is_active, view_count, last_viewed_at, created_at, revoked_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RecordShare[];
    },
    enabled: !!patientId,
  });
}

export function useCreateRecordShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sections,
      expiresInHours,
    }: {
      sections: RecordShareSection[];
      expiresInHours: number;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_record_share", {
        p_sections: sections,
        p_expires_in_hours: expiresInHours,
      });
      if (error) throw error;
      return data as { id: string; token: string; sections: string[]; expires_at: string; created_at: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["record-shares"] });
    },
  });
}

export function useRevokeRecordShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("revoke_record_share", {
        p_share_id: shareId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["record-shares"] });
    },
  });
}

export function recordShareUrl(token: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tarragonhealth.ng";
  return `${base}/share/${token}`;
}
