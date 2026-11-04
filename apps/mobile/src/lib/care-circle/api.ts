import type { QueryResult } from "../medications";
import { CIRCLE_TASK_NOTE_MAX } from "@tarragon/shared";
import { supabase } from "../supabase";
import {
  circleErrorKey, parseDeclined, parseDigest, parseNudges, parseTasks, parseToolsStatus, parseAcceptInvite, parseAlerts, parseCheckInPending, parseCheckInResult, parseInvitePreview, parseUnanswered, parseGiftAnswer, parsePendingGifts, parseInviteMade, parseMyCircle, parseOk, parsePaused, parsePreviewView, parseSupported, parseSupporterView, parseViewLog, parseGiftPayers, parseMyFamilyNotes, validGiftShare, isUuid,
  parseShareOffers, parseRespondOffer, parseGiftShareResult, parseSharingHistory, type ShareOffer, type SharingHistoryRow,
  type GiftPayer, type MyFamilyNote, type AlertMode, type CircleDigest, type CircleNudge, type CircleTaskList, type ToolsStatus, type CheckInResult, type CirclePermission, type InvitePreview, type UnansweredCheckIn, type InviteMade, type PendingGift, type MyCircle, type OpenAlert, type PreviewView, type SupportedPerson, type SupporterView, type ViewLogRow,
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
/** S75 A5: the patient's switch for sharing the monthly report with one supporter. Off by default. */
export async function setMonthlyReportShare(memberId: string, on: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("set_circle_monthly_report_share", { p_member: memberId, p_on: on });
  return !error;
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

/** The join screen: the database answers the same silent `{ok: false}` for every failure, so nothing here says who was invited. */
export async function previewInvite(token: string): Promise<InvitePreview | "unreachable"> {
  const { data, error } = await supabase.rpc("preview_care_circle_invite", { p_token: token });
  // a failed call is not the same as a bad link: the first is worth retrying, the second is not
  return error ? "unreachable" : parseInvitePreview(data);
}
export async function acceptInvite(token: string): Promise<{ ok: true; patientId: string } | { ok: false } | "unreachable"> {
  const { data, error } = await supabase.rpc("accept_care_circle_invite", { p_token: token });
  return error ? "unreachable" : parseAcceptInvite(data);
}

/** S29e: is the patient-first check-in window open at all? null: the read failed. The supporter's button needs a clear true; the patient's answer path keeps working unless this says false. */
export async function checkInWindowOpen(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("circle_checkin_window_enabled");
  return error ? null : data === true;
}
/** A supporter asks a person to check in. null means the answer was not saved or not understood. */
export async function requestCheckIn(patientId: string): Promise<CheckInResult | null> {
  const { data, error } = await supabase.rpc("request_circle_check_in", { p_patient: patientId });
  return error ? null : parseCheckInResult(data);
}
/** null: the read failed (shown as such, never as "nothing waiting"). */
export async function loadCheckInPending(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("circle_check_in_pending");
  return error ? null : parseCheckInPending(data);
}
/** "I called them" on a person who did not answer a check-in. */
export async function ackUnanswered(patientId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("circle_ack_unanswered", { p_patient: patientId });
  return !error && data === true;
}
/** true: the answer landed on a question still waiting. false: it had already ended (the circle may have been told). null: not saved. */
export async function answerCheckIn(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("respond_to_circle_check_in");
  return error ? null : data === true;
}
export async function loadUnanswered(): Promise<QueryResult<UnansweredCheckIn[]>> {
  const { data, error } = await supabase.rpc("circle_unanswered_check_ins");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseUnanswered(data) };
}

// ---------------------------------------------------------------------------
// S69b
// ---------------------------------------------------------------------------
/** Which tools are on. A failed read is "all off". */
export async function loadToolsStatus(): Promise<ToolsStatus> {
  const { data, error } = await supabase.rpc("circle_tools_status");
  return error ? parseToolsStatus(null) : parseToolsStatus(data);
}
/** "Not now": silent for the person who asked. false: it was not saved (the screen says so; the invite stays open). */
export async function declineInvite(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("decline_care_circle_invite", { p_token: token });
  return !error && parseDeclined(data);
}
export async function setMissedDoseAlert(memberId: string, on: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("set_circle_missed_dose_alert", { p_member: memberId, p_on: on });
  return !error;
}
/** null: the module is off, the access ended or the read failed; the screen shows nothing for any of them. */
export async function loadTasks(patientId: string): Promise<CircleTaskList | null> {
  const { data, error } = await supabase.rpc("circle_tasks", { p_patient: patientId });
  return error ? null : parseTasks(data);
}
export type PostTaskResult = { ok: true } | { ok: false; reason: "limit" | "note_needed" | "note_too_long" | "error" };
/**
 * Post a help request. `recipients` (membership ids) and `note` are the patient's only (Care Circle P3, D4); a helper passes neither.
 * Nobody ticked means everyone who helps. Kind "other" needs a note; both are checked here and again by the database.
 */
export async function postTask(
  patientId: string, kind: string, neededBy: string | null, opts: { recipients?: readonly string[]; note?: string | null } = {},
): Promise<PostTaskResult> {
  const note = opts.note?.trim() ? opts.note.trim() : null;
  if (note && note.length > CIRCLE_TASK_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  if (kind === "other" && !note) return { ok: false, reason: "note_needed" };
  const recipients = opts.recipients && opts.recipients.length > 0 ? [...new Set(opts.recipients)] : null;
  // fail closed: a request meant for chosen people must never be widened to everyone because an id could not be read
  if (recipients && !recipients.every(isUuid)) return { ok: false, reason: "error" };
  const { error } = await supabase.rpc("post_circle_task", {
    p_patient: patientId, p_kind: kind,
    ...(neededBy ? { p_needed_by: neededBy } : {}),
    ...(recipients ? { p_recipients: recipients } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (!error) return { ok: true };
  return { ok: false, reason: error.message.includes("task_limit") ? "limit" : error.message.includes("task_other_needs_note") ? "note_needed" : error.message.includes("task_note_too_long") ? "note_too_long" : "error" };
}
export type TaskAction = "claim_circle_task" | "release_circle_task" | "complete_circle_task" | "cancel_circle_task" | "decline_circle_task";
/** true: done. false: it was no longer possible (for a claim: someone else got there first). null: not saved. */
export async function taskAction(action: TaskAction, taskId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc(action, { p_task: taskId });
  return error ? null : data === true;
}
export async function loadDigest(patientId: string): Promise<CircleDigest | null> {
  const { data, error } = await supabase.rpc("circle_weekly_digest", { p_patient: patientId });
  return error ? null : parseDigest(data);
}
export async function loadNudges(): Promise<CircleNudge[]> {
  const { data, error } = await supabase.rpc("circle_recent_nudges");
  return error ? [] : parseNudges(data);
}

// ---------------------------------------------------------------------------
// 2026-11-03: sharing with the person who paid for a gift the patient accepted
// ---------------------------------------------------------------------------
/** Payers of accepted gifts who see nothing yet. First name only. A failed read is "none": this is an offer, never a required step. */
export async function loadGiftPayers(): Promise<GiftPayer[]> {
  const { data, error } = await supabase.rpc("circle_gift_payers");
  return error ? [] : parseGiftPayers(data);
}
/** "Not now", remembered per payer: the offer never comes back for that payer. A failed save shares nothing either way. */
export async function dismissGiftPayer(payerId: string): Promise<boolean> {
  if (!isUuid(payerId)) return false;
  const { data, error } = await supabase.rpc("dismiss_gift_payer_offer", { p_payer: payerId });
  return !error && data === true;
}
/** The patient's own notes from the doctor (latest first). A failed read is "none": nothing is shared by not showing it. */
export async function loadMyFamilyNotes(): Promise<MyFamilyNote[]> {
  const { data, error } = await supabase.rpc("my_family_notes");
  return error ? [] : parseMyFamilyNotes(data);
}
/** Share or un-share one note. Only the patient can (the database checks). Null means it was not saved. */
export async function setFamilyNoteShared(noteId: string, share: boolean): Promise<boolean | null> {
  if (!isUuid(noteId)) return null;
  const { data, error } = await supabase.rpc("set_family_note_shared", { p_note: noteId, p_share: share });
  return error || typeof data !== "boolean" ? null : data;
}
/** `offered` (P1, D3): true means the payer was asked and sees nothing until they say yes; false means an existing member now sees more. */
export type GiftShareAnswer = { ok: true; offered: boolean } | { ok: false; reason: "invalid" | "full" | "failed" };
/**
 * The patient's tap. Checked here before anything is sent; the database checks again (auth.uid() is the patient, the payer must have paid
 * for a gift this patient accepted, the list is limited, under 18 is refused). Nothing is shared without this call.
 */
export async function shareWithGiftPayer(payerId: string, permissions: readonly string[], monthlyReport: boolean): Promise<GiftShareAnswer> {
  if (!validGiftShare(payerId, permissions)) return { ok: false, reason: "invalid" };
  const { data, error } = await supabase.rpc("share_circle_with_gift_payer", { p_payer: payerId, p_permissions: [...permissions], p_monthly_report: monthlyReport });
  if (error) return { ok: false, reason: error.message.includes("circle_full") ? "full" : "failed" };
  const r = parseGiftShareResult(data);
  return r ? { ok: true, offered: r.offered } : { ok: false, reason: "failed" };
}

// ---------------------------------------------------------------------------
// Care Circle P1 (founder decision D3, 2026-11-04): offers to a person who paid, and the patient's history of sharing changes
// ---------------------------------------------------------------------------
/** The payer's open offers. A failed read is "none": an offer is never a required step. */
export async function loadShareOffers(): Promise<ShareOffer[]> {
  const { data, error } = await supabase.rpc("my_circle_share_offers");
  return error ? [] : parseShareOffers(data);
}
/**
 * Yes or no. `{ failed: "full" }`: the person's circle filled up before this answer, so trying again cannot help (CC-COPY-P5b);
 * `{ failed: "error" }`: not saved for any other reason (the database checks the caller is the person asked and the offer is still open).
 */
export async function respondToShareOffer(memberId: string, accept: boolean): Promise<{ accepted: boolean } | { failed: "full" | "error" }> {
  if (!isUuid(memberId)) return { failed: "error" };
  const { data, error } = await supabase.rpc("respond_to_circle_share_offer", { p_member: memberId, p_accept: accept });
  if (error) return { failed: error.message.includes("circle_full") ? "full" : "error" };
  return parseRespondOffer(data) ?? { failed: "error" };
}
/** The patient takes back an offer nobody has answered yet. */
export async function withdrawShareOffer(memberId: string): Promise<boolean> {
  if (!isUuid(memberId)) return false;
  const { data, error } = await supabase.rpc("withdraw_circle_share_offer", { p_member: memberId });
  return !error && data === true;
}
/** The patient's own history of who may see what (the database returns only the caller's rows). */
export async function loadSharingHistory(): Promise<QueryResult<SharingHistoryRow[]>> {
  const { data, error } = await supabase.rpc("my_circle_sharing_history", { p_limit: 50 });
  return error ? { ok: false, error: error.message } : { ok: true, data: parseSharingHistory(data) };
}
