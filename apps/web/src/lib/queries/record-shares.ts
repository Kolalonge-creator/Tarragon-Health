import { createClient } from "@/lib/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type RecordShareSection =
  | "vitals"
  | "medications"
  | "conditions"
  | "allergies"
  | "lab_results"
  | "vaccinations"
  | "emergency_info"
  | "procedures"
  | "family_history";

/**
 * The closed set a link can carry. Mental health and reproductive health records
 * are deliberately not members: the database refuses them (record_shares_sections_valid),
 * so they are off by default and cannot be added by accident (S43, spec 2.8).
 */
export const SHARE_SECTIONS: RecordShareSection[] = [
  "vitals",
  "medications",
  "conditions",
  "allergies",
  "lab_results",
  "vaccinations",
  "emergency_info",
  "procedures",
  "family_history",
];

/**
 * A link as the owner sees it. The token is never here: it is held only as a
 * hash, shown once when the link is made, and cannot be read back.
 */
export type RecordShare = {
  id: string;
  sections: RecordShareSection[];
  expires_at: string;
  is_active: boolean;
  view_count: number;
  max_views: number | null;
  has_pin: boolean | null;
  locked_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type RecordShareAttempt = {
  id: string;
  share_id: string;
  outcome: "viewed" | "expired" | "revoked" | "view_cap" | "pin_wrong" | "locked";
  looked_up_at: string;
};

export type RecordShareConfig = { default_hours: number; max_hours: number; min_pin_length: number };

export function useRecordShares(patientId: string) {
  return useQuery({
    queryKey: ["record-shares", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("record_shares")
        .select("id, sections, expires_at, is_active, view_count, max_views, has_pin, locked_at, last_viewed_at, created_at, revoked_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RecordShare[];
    },
    enabled: !!patientId,
  });
}

/** Every opening and every refused attempt against the owner's own links, newest first. */
export function useRecordShareAttempts(patientId: string) {
  return useQuery({
    queryKey: ["record-share-attempts", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("record_share_lookups")
        .select("id, share_id, outcome, looked_up_at")
        .order("looked_up_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as RecordShareAttempt[];
    },
    enabled: !!patientId,
  });
}

/** The active versioned setting: how long a link lasts unless the person chooses otherwise. */
export function useRecordShareConfig() {
  return useQuery({
    queryKey: ["record-share-config"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("record_share_config")
        .select("default_hours, max_hours, min_pin_length")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as RecordShareConfig | null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type CreatedShare = { id: string; token: string; sections: string[]; expires_at: string; created_at: string; has_pin: boolean; max_views: number | null };

export function useCreateRecordShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sections,
      expiresInHours,
      pin,
      maxViews,
    }: {
      sections: RecordShareSection[];
      /** Omit to take the configured default. */
      expiresInHours?: number;
      pin?: string;
      maxViews?: number;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_record_share", {
        p_sections: sections,
        p_expires_in_hours: expiresInHours,
        p_pin: pin || undefined,
        p_max_views: maxViews,
      });
      if (error) throw error;
      return data as unknown as CreatedShare;
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
      const { error } = await supabase.rpc("revoke_record_share", { p_share_id: shareId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["record-shares"] });
      queryClient.invalidateQueries({ queryKey: ["record-share-attempts"] });
    },
  });
}

export function recordShareUrl(token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tarragonhealth.ng");
  return `${base}/share/${token}`;
}
