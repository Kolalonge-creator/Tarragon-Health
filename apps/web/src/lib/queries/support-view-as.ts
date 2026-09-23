import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SupportViewSession = Tables<"support_view_sessions">;

/** Shared by the console list and the session page — one definition of "still active". */
export function isSupportViewSessionActive(session: {
  ended_at: string | null;
  expires_at: string;
}): boolean {
  return !session.ended_at && new Date(session.expires_at).getTime() > Date.now();
}

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
 * 20260922175144_support_view_as.sql section 8.
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

/**
 * The caller's own sessions — active ones surface a resume link, ended ones a recent-history
 * list. Deliberately reads subject_full_name/subject_role straight off the session row (a
 * server-derived snapshot, immutable once set — see the migration) rather than embedding a
 * live `profiles` join: once a session ends, private.can_support_view() correctly stops
 * granting a live profiles read for a non-admin/non-org-staff viewer, which would make an
 * embed show null forever — this row's own record of who it was about must not depend on a
 * read grant its own ending just revoked.
 *
 * Explicitly filtered to viewer_id = the caller — support_view_sessions_select's RLS policy
 * also admits rows where the caller is the SUBJECT (so they can see who viewed them) or an
 * admin, and without this filter this "your sessions" list would silently mix in sessions
 * someone else ran against the caller's own account.
 */
export function useMySupportViewSessions() {
  return useQuery({
    queryKey: ["support-view-as-sessions"],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("support_view_sessions")
        .select("*")
        .eq("viewer_id", user.id)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as SupportViewSession[];
    },
    refetchInterval: 30_000,
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
    mutationFn: async ({
      subjectId,
      subjectRole,
      reason,
    }: {
      subjectId: string;
      subjectRole: "patient" | "clinician";
      reason: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // viewer_id/subject_role are required by the column (not null, no SQL-level default —
      // this codebase's generated Insert type reflects that), but neither carries any
      // authority: private.enforce_support_view_session_rules() (the BEFORE INSERT trigger)
      // unconditionally re-derives both from auth.uid() and a fresh public.profiles lookup,
      // so whatever is sent here is never trusted.
      const { data, error } = await supabase
        .from("support_view_sessions")
        .insert({ viewer_id: user.id, subject_id: subjectId, subject_role: subjectRole, reason })
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
