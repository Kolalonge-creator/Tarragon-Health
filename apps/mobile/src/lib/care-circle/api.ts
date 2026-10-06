import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import {
  circleErrorKey, parseAlerts, parseInviteMade, parseMyCircle, parseSupported, parseSupporterView, parseViewLog,
  type CirclePermission, type InviteMade, type MyCircle, type OpenAlert, type SupportedPerson, type SupporterView, type ViewLogRow,
} from "./parse";

export async function loadMyCircle(): Promise<QueryResult<MyCircle>> {
  const { data, error } = await supabase.rpc("my_care_circle");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseMyCircle(data) };
}
export async function loadViewLog(): Promise<QueryResult<ViewLogRow[]>> {
  const { data, error } = await supabase.rpc("circle_view_log", { p_limit: 30 });
  return error ? { ok: false, error: error.message } : { ok: true, data: parseViewLog(data) };
}
export async function loadSupported(): Promise<QueryResult<SupportedPerson[]>> {
  const { data, error } = await supabase.rpc("my_supported_people");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseSupported(data) };
}
export async function loadOpenAlerts(): Promise<QueryResult<OpenAlert[]>> {
  const { data, error } = await supabase.rpc("circle_open_alerts");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseAlerts(data) };
}

/** A supporter's one read about a person. `null` data means the access ended; that is a normal answer, not an error. */
export async function loadSupporterView(patientId: string): Promise<QueryResult<SupporterView | null>> {
  const { data, error } = await supabase.rpc("circle_supporter_view", { p_patient: patientId });
  if (error) return error.message.includes("circle_not_found") ? { ok: true, data: null } : { ok: false, error: error.message };
  return { ok: true, data: parseSupporterView(data) };
}

export async function createInvite(input: { kind: "phone" | "email"; contact: string; relationship: string; permissions: CirclePermission[]; days: number }): Promise<InviteMade> {
  const { data, error } = await supabase.rpc("create_care_circle_invite", {
    p_kind: input.kind, p_contact: input.contact, p_relationship: input.relationship, p_permissions: input.permissions, p_grant_days: input.days,
  });
  if (error) return { ok: false, errorKey: circleErrorKey(error.message) };
  const made = parseInviteMade(data);
  return made ? { ok: true, ...made } : { ok: false, errorKey: "circle.error.unknown" };
}

export async function cancelInvite(inviteId: string): Promise<boolean> {
  const { error } = await supabase.rpc("cancel_care_circle_invite", { p_invite: inviteId });
  return !error;
}
export async function updateMember(memberId: string, permissions: CirclePermission[], expiresAt?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("update_care_circle_member", { p_member: memberId, p_permissions: permissions, ...(expiresAt ? { p_expires_at: expiresAt } : {}) });
  return !error && data === true;
}
/** The patient removes a member, or a supporter leaves: the database allows exactly those two people. */
export async function revokeMember(memberId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("revoke_care_circle_member", { p_member: memberId });
  return !error && data === true;
}
