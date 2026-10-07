import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMadeSchema,
  parseBoard,
  parseChallenges,
  parseModReports,
  parseMyCohorts,
  parseOk,
  parsePreview,
  parseRoster,
  parseTemplates,
  type ReportReason,
} from "@/lib/community/model";

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
      const { data, error } = await createClient().rpc("community_my_cohorts");
      if (error) throw new CommunityError(error.message);
      return parseMyCohorts(data);
    },
  });
}

export function useCohortChallenges(cohortId: string) {
  return useQuery({
    queryKey: communityKeys.group(cohortId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("community_challenges", { p_cohort: cohortId });
      if (error) throw new CommunityError(error.message);
      return parseChallenges(data);
    },
  });
}

export function useRoster(cohortId: string) {
  return useQuery({
    queryKey: communityKeys.roster(cohortId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("community_roster", { p_cohort: cohortId });
      if (error) throw new CommunityError(error.message);
      return parseRoster(data);
    },
  });
}

export function useBoard(challengeId: string) {
  return useQuery({
    queryKey: communityKeys.board(challengeId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("community_board", { p_challenge: challengeId });
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
      const { data, error } = await createClient().rpc("community_moderator_reports", { p_cohort: cohortId });
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
      const { data, error } = await createClient().rpc("community_preview_invite", { p_token: token });
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
      rpc(createClient().rpc("community_create", { p_name: v.name, p_kind: v.kind, p_consent_join: v.consent })),
    ALL,
  );
}

export function useJoin() {
  return useRpcMutation((v: { token: string; consent: boolean }) => rpc(createClient().rpc("community_join", { p_token: v.token, p_consent_join: v.consent })), ALL);
}

export function useLeave() {
  return useRpcMutation((cohort: string) => rpc(createClient().rpc("community_leave", { p_cohort: cohort })), ALL);
}

export function useMute() {
  return useRpcMutation((v: { cohort: string; muted: boolean }) => rpc(createClient().rpc("community_set_muted", { p_cohort: v.cohort, p_muted: v.muted })), ALL);
}

export function useTotalsConsent() {
  return useRpcMutation((v: { cohort: string; on: boolean }) => rpc(createClient().rpc("community_set_totals_consent", { p_cohort: v.cohort, p_on: v.on })), ALL);
}

export function useCommunityOff() {
  return useRpcMutation((off: boolean) => rpc(createClient().rpc("set_community_off", { p_off: off })), ALL);
}

export function useReport() {
  return useRpcMutation(
    (v: { cohort: string; member: string | null; reason: ReportReason }) =>
      rpc(createClient().rpc("community_report", { p_cohort: v.cohort, p_member: v.member ?? undefined, p_reason: v.reason })),
    ALL,
  );
}

export function useRemoveMember() {
  return useRpcMutation((v: { cohort: string; member: string }) => rpc(createClient().rpc("community_remove_member", { p_cohort: v.cohort, p_member: v.member })), ALL);
}

export function useCloseCohort() {
  return useRpcMutation((cohort: string) => rpc(createClient().rpc("community_close", { p_cohort: cohort })), ALL);
}

export function useStartChallenge() {
  return useRpcMutation(
    (v: { cohort: string; template: string; startsOn: string; days: number }) =>
      rpc(createClient().rpc("community_start_challenge", { p_cohort: v.cohort, p_template: v.template, p_starts_on: v.startsOn, p_days: v.days })),
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
      const data = await rpc(createClient().rpc("community_create_invite", { p_cohort: cohort }));
      const r = inviteMadeSchema.safeParse(data);
      if (!r.success) throw new CommunityError("unknown");
      return r.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community"] }),
  });
}
