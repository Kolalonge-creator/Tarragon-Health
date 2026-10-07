import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import {
  communityErrorKey, parseBoard, parseChallenges, parseInviteMade, parseMyCohorts, parseOk, parsePreview, parseRoster, parseTemplates,
  type Board, type Challenge, type MyCohorts, type RosterRow, type Template,
} from "./parse";
import type { MessageKey } from "@tarragon/i18n";

type Ok = ReturnType<typeof parseOk>;
const fail = (message: string): { ok: false; errorKey: MessageKey } => ({ ok: false, errorKey: communityErrorKey(message) });
export type Done = { ok: true; result: Ok } | { ok: false; errorKey: MessageKey };

async function act(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Done> {
  const { data, error } = await call;
  return error ? fail(error.message) : { ok: true, result: parseOk(data) };
}

export async function loadMyCohorts(): Promise<QueryResult<MyCohorts>> {
  const { data, error } = await supabase.rpc("community_my_cohorts");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseMyCohorts(data) };
}
export async function loadChallenges(cohort: string): Promise<QueryResult<Challenge[]>> {
  const { data, error } = await supabase.rpc("community_challenges", { p_cohort: cohort });
  return error ? { ok: false, error: error.message } : { ok: true, data: parseChallenges(data) };
}
export async function loadRoster(cohort: string): Promise<QueryResult<RosterRow[]>> {
  const { data, error } = await supabase.rpc("community_roster", { p_cohort: cohort });
  return error ? { ok: false, error: error.message } : { ok: true, data: parseRoster(data) };
}
export async function loadBoard(challenge: string): Promise<QueryResult<Board>> {
  const { data, error } = await supabase.rpc("community_board", { p_challenge: challenge });
  return error ? { ok: false, error: error.message } : { ok: true, data: parseBoard(data) };
}
export async function loadTemplates(): Promise<QueryResult<Template[]>> {
  const { data, error } = await supabase.rpc("list_challenge_templates");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseTemplates(data) };
}
export async function previewInvite(token: string) {
  const { data, error } = await supabase.rpc("community_preview_invite", { p_token: token });
  return error ? parsePreview(null) : parsePreview(data);
}
export const joinCohort = (token: string, consent: boolean) => act(supabase.rpc("community_join", { p_token: token, p_consent_join: consent }));
export const createCohort = (name: string, kind: string, consent: boolean) => act(supabase.rpc("community_create", { p_name: name, p_kind: kind, p_consent_join: consent }));
export const leaveCohort = (cohort: string) => act(supabase.rpc("community_leave", { p_cohort: cohort }));
export const setMuted = (cohort: string, muted: boolean) => act(supabase.rpc("community_set_muted", { p_cohort: cohort, p_muted: muted }));
export const setTotalsConsent = (cohort: string, on: boolean) => act(supabase.rpc("community_set_totals_consent", { p_cohort: cohort, p_on: on }));
export const setCommunityOff = (off: boolean) => act(supabase.rpc("set_community_off", { p_off: off }));
export const contribute = (challenge: string, minutes?: number) => act(supabase.rpc("contribute_to_challenge", { p_challenge: challenge, p_minutes: minutes }));
export const startChallenge = (cohort: string, template: string, startsOn: string, days: number) =>
  act(supabase.rpc("community_start_challenge", { p_cohort: cohort, p_template: template, p_starts_on: startsOn, p_days: days }));
export const reportMember = (cohort: string, member: string, reason: string) => act(supabase.rpc("community_report", { p_cohort: cohort, p_member: member, p_reason: reason }));
export const closeCohort = (cohort: string) => act(supabase.rpc("community_close", { p_cohort: cohort }));

/** The moderator makes an invite link. The token comes back once and only its hash is stored. */
export async function createInvite(cohort: string): Promise<{ ok: true; token: string } | { ok: false; errorKey: MessageKey }> {
  const { data, error } = await supabase.rpc("community_create_invite", { p_cohort: cohort });
  if (error) return fail(error.message);
  const made = parseInviteMade(data);
  return made ? { ok: true, token: made.token } : fail("unknown");
}
