import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMadeSchema,
  parseBoard,
  parseHistory,
  parseSummary,
  parseChallenges,
  parseModReports,
  parseMyCohorts,
  parseOk,
  parsePreview,
  parseRoster,
  parseTemplates,
  type ReportReason,
} from "@/lib/cohorts/model";

export const communityKeys = {
  mine: ["community", "mine"] as const,
  group: (id: string) => ["community", "group", id] as const,
  roster: (id: string) => ["community", "roster", id] as const,
  reports: (id: string) => ["community", "reports", id] as const,
  board: (challengeId: string) => ["community", "board", challengeId] as const,
  templates: ["community", "templates"] as const,
};

export class CommunityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityError";
  }
}

export function useMyCohorts() {
  return useQuery({
    queryKey: communityKeys.mine,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_my_cohorts");
      if (error) throw new CommunityError(error.message);
      return parseMyCohorts(data);
    },
  });
}

export function useCohortChallenges(cohortId: string) {
  return useQuery({
    queryKey: communityKeys.group(cohortId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_challenges", { p_cohort: cohortId });
      if (error) throw new CommunityError(error.message);
      return parseChallenges(data);
    },
  });
}

export function useRoster(cohortId: string) {
  return useQuery({
    queryKey: communityKeys.roster(cohortId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_roster", { p_cohort: cohortId });
      if (error) throw new CommunityError(error.message);
      return parseRoster(data);
    },
  });
}

export function useBoard(challengeId: string) {
  return useQuery({
    queryKey: communityKeys.board(challengeId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_board", { p_challenge: challengeId });
      if (error) throw new CommunityError(error.message);
      return parseBoard(data);
    },
  });
}

export function useModeratorReports(cohortId: string, enabled: boolean) {
  return useQuery({
    queryKey: communityKeys.reports(cohortId),
    enabled,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_moderator_reports", { p_cohort: cohortId });
      if (error) throw new CommunityError(error.message);
      return parseModReports(data);
    },
  });
}

export function useTemplates(enabled: boolean) {
  return useQuery({
    queryKey: communityKeys.templates,
    enabled,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("list_challenge_templates");
      if (error) throw new CommunityError(error.message);
      return parseTemplates(data);
    },
  });
}

export function usePreviewInvite(token: string) {
  return useQuery({
    queryKey: ["community", "preview", token],
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cohort_preview_invite", { p_token: token });
      if (error) return parsePreview(null);
      return parsePreview(data);
    },
  });
}

function useRpcMutation<TVars>(run: (vars: TVars) => Promise<unknown>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const data = await run(vars);
      return parseOk(data);
    },
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key as unknown[] });
    },
  });
}

async function rpc<T>(call: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await call;
  if (error) throw new CommunityError(error.message);
  return data;
}

const ALL = [["community"]] as const;

export function useCreateCohort() {
  return useRpcMutation(
    (v: { name: string; kind: string; consent: boolean }) =>
      rpc(createClient().rpc("cohort_create", { p_name: v.name, p_kind: v.kind, p_consent_join: v.consent })),
    ALL,
  );
}

export function useJoin() {
  return useRpcMutation((v: { token: string; consent: boolean }) => rpc(createClient().rpc("cohort_join", { p_token: v.token, p_consent_join: v.consent })), ALL);
}

export function useLeave() {
  return useRpcMutation((cohort: string) => rpc(createClient().rpc("cohort_leave", { p_cohort: cohort })), ALL);
}

export function useMute() {
  return useRpcMutation((v: { cohort: string; muted: boolean }) => rpc(createClient().rpc("cohort_set_muted", { p_cohort: v.cohort, p_muted: v.muted })), ALL);
}

export function useTotalsConsent() {
  return useRpcMutation((v: { cohort: string; on: boolean }) => rpc(createClient().rpc("cohort_set_totals_consent", { p_cohort: v.cohort, p_on: v.on })), ALL);
}

export function useCommunityOff() {
  return useRpcMutation((off: boolean) => rpc(createClient().rpc("set_community_off", { p_off: off })), ALL);
}

export function useReport() {
  return useRpcMutation(
    (v: { cohort: string; member: string | null; reason: ReportReason }) =>
      rpc(createClient().rpc("cohort_report", { p_cohort: v.cohort, p_member: v.member ?? undefined, p_reason: v.reason })),
    ALL,
  );
}

export function useRemoveMember() {
  return useRpcMutation((v: { cohort: string; member: string }) => rpc(createClient().rpc("cohort_remove_member", { p_cohort: v.cohort, p_member: v.member })), ALL);
}

export function useCloseCohort() {
  return useRpcMutation((cohort: string) => rpc(createClient().rpc("cohort_close", { p_cohort: cohort })), ALL);
}

export function useStartChallenge() {
  return useRpcMutation(
    (v: { cohort: string; template: string; startsOn: string; days: number }) =>
      rpc(createClient().rpc("cohort_start_challenge", { p_cohort: v.cohort, p_template: v.template, p_starts_on: v.startsOn, p_days: v.days })),
    ALL,
  );
}

/** S69c: the member's own summary for one challenge (weeks active, whether this week is skipped). Never part of a group view. */
export function useChallengeSummary(challengeId: string) {
  return useQuery({
    queryKey: ["community", "summary", challengeId] as const,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_challenge_summary", { p_challenge: challengeId });
      if (error) throw new CommunityError(error.message);
      return parseSummary(data);
    },
  });
}

/** S69c: the member's own effort history, kept after a challenge ends. */
export function useEffortHistory() {
  return useQuery({
    queryKey: ["community", "history"] as const,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_effort_history");
      if (error) throw new CommunityError(error.message);
      return parseHistory(data);
    },
  });
}

export function useRestCheckin() {
  return useRpcMutation((challenge: string) => rpc(createClient().rpc("rest_checkin_for_challenge", { p_challenge: challenge })), ALL);
}

/** Skip (or take back the skip of) this week. Nothing is sent to the group. */
export function useSkipWeek() {
  return useRpcMutation(
    (v: { challenge: string; skip: boolean }) =>
      rpc(v.skip ? createClient().rpc("skip_challenge_week", { p_challenge: v.challenge }) : createClient().rpc("undo_skip_challenge_week", { p_challenge: v.challenge })),
    ALL,
  );
}

export function useContribute() {
  return useRpcMutation(
    (v: { challenge: string; minutes?: number }) =>
      rpc(createClient().rpc("contribute_to_challenge", { p_challenge: v.challenge, p_minutes: v.minutes })),
    ALL,
  );
}

/** The moderator makes an invite. The token comes back once and is shown once; only its hash is stored. */
export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cohort: string) => {
      const data = await rpc(createClient().rpc("cohort_create_invite", { p_cohort: cohort }));
      const r = inviteMadeSchema.safeParse(data);
      if (!r.success) throw new CommunityError("unknown");
      return r.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community"] }),
  });
}
