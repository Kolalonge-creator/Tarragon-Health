import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SupportViewSession = Tables<"support_view_sessions">;

export type SupportViewSubject = {
  id: string;
  full_name: string | null;
  role: "patient" | "clinician";
  phone: string | null;
  organisation_id: string | null;
};

/**
 * Look up a candidate subject by name/phone/patient number, via
 * public.search_support_view_subjects() — NOT a direct profiles select. A delegated
 * (non-admin) support.view_as grantee outside the subject's own organisation has no RLS
 * read on public.profiles until a session already exists (private.can_support_view
 * requires one), so a plain table select would return nothing for exactly the caller
 * this search is for. The RPC is gated by the same permission instead, and returns only
 * already-low-sensitivity identity fields — never clinical data. See
 * 20260918104500_support_view_as.sql section 8.
 */
export function useSupportViewAsSubjectSearch(query: string) {
  return useQuery({
    queryKey: ["support-view-as-subject-search", query],
    enabled: query.trim().length >= 2,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_support_view_subjects", { p_query: query });
      if (error) throw error;
      return (data ?? []) as SupportViewSubject[];
    },
  });
}

/** The caller's own sessions — active ones surface a resume link, ended ones a recent-history list. */
export function useMySupportViewSessions() {
  return useQuery({
    queryKey: ["support-view-as-sessions"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_view_sessions")
        .select("*, subject:profiles!support_view_sessions_subject_id_fkey(id, full_name, role)")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useSupportViewSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["support-view-as-session", sessionId ?? ""],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_view_sessions")
        .select("*")
        .eq("id", sessionId as string)
        .single();
      if (error) throw error;
      return data as SupportViewSession;
    },
    // Short poll while on the shadow-view page itself, so an expiring countdown / an
    // early end (by the subject, from another tab) is reflected without a manual reload.
    refetchInterval: 15_000,
  });
}

/**
 * Starts a session. The insert itself carries no authority — RLS's insert policy only
 * checks "is this caller the viewer they claim to be"; private.enforce_support_view_
 * session_rules() (the BEFORE INSERT trigger) is the real authority: it checks the
 * support.view_as permission, refuses any subject that isn't a patient/clinician, and
 * re-derives started_at/expires_at server-side regardless of what's sent here.
 */
export function useStartSupportViewSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ subjectId, reason }: { subjectId: string; reason: string }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("support_view_sessions")
        .insert({ viewer_id: user.id, subject_id: subjectId, reason })
        .select("*")
        .single();
      if (error) throw error;
      return data as SupportViewSession;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["support-view-as-sessions"] });
    },
  });
}

/** Ends a session early. private.guard_support_view_session_update() derives ended_by/ended_at server-side. */
export function useEndSupportViewSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("support_view_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: (_data, sessionId) => {
      void queryClient.invalidateQueries({ queryKey: ["support-view-as-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["support-view-as-session", sessionId] });
    },
  });
}
