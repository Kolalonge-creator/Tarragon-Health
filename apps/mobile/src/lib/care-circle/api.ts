import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import {
  circleErrorKey, parseAlerts, parseGiftAnswer, parsePendingGifts, parseInviteMade, parseMyCircle, parseOk, parsePaused, parsePreviewView, parseSupported, parseSupporterView, parseViewLog,
  type AlertMode, type CirclePermission, type InviteMade, type PendingGift, type MyCircle, type OpenAlert, type PreviewView, type SupportedPerson, type SupporterView, type ViewLogRow,
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

export async function loadPendingGifts(): Promise<QueryResult<PendingGift[]>> {
  const { data, error } = await supabase.rpc("my_pending_gifts");
  return error ? { ok: false, error: error.message } : { ok: true, data: parsePendingGifts(data) };
}
/** The patient's yes or no to a care pack or Membership someone else paid for. Null means the answer was not saved. */
export async function answerGift(entitlementId: string, accept: boolean): Promise<"accepted" | "declined" | null> {
  const { data, error } = await supabase.rpc("respond_to_gifted_pack", { p_entitlement: entitlementId, p_accept: accept });
  return error ? null : parseGiftAnswer(data);
}

/** One tap: another year from today, never shorter than the access already has. The database does the date arithmetic. */
export async function renewMember(memberId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("renew_care_circle_member", { p_member: memberId });
  return !error && parseOk(data);
}
/** Pause all sharing for the configured days; `pauseAlerts` also holds back the check-in requests. */
export async function pauseCircle(pauseAlerts: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("pause_care_circle", { p_pause_alerts: pauseAlerts });
  return !error && parsePaused(data);
}
export async function resumeCircle(): Promise<boolean> {
  const { data, error } = await supabase.rpc("resume_care_circle");
  return !error && data === true;
}
/** What a supporter sees right now (read only, never logged as a look). */
export async function loadPreviewMember(memberId: string): Promise<QueryResult<PreviewView | null>> {
  const { data, error } = await supabase.rpc("circle_preview_member", { p_member: memberId });
  return error ? { ok: false, error: error.message } : { ok: true, data: parsePreviewView(data) };
}
/** What these choices would show, before anyone is invited. */
export async function loadPreviewPermissions(permissions: CirclePermission[], relationship: string): Promise<QueryResult<PreviewView | null>> {
  const { data, error } = await supabase.rpc("circle_preview_permissions", { p_permissions: permissions, p_relationship: relationship });
  return error ? { ok: false, error: error.message } : { ok: true, data: parsePreviewView(data) };
}
export async function setAlertMode(patientId: string, mode: AlertMode): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_circle_alert_mode", { p_patient: patientId, p_mode: mode });
  return !error && data === true;
}
/** "I called them": one status, no text. */
export async function ackAlert(patientId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("circle_ack_alert", { p_patient: patientId });
  return !error && data === true;
}
