import { parseCircleMonthly, type CircleMonthlyRow, type MessageKey } from "@tarragon/i18n";

/**
 * What the Care Circle sections read (S29). Parsed by hand and never trusted: a row that does not match is dropped, and a reply
 * that is not what was expected means "nothing to show". The supporter view is the only thing a supporter can read about a
 * patient; a block that is absent is "not shared", never "zero".
 */
export const CIRCLE_PERMISSIONS = [
  "adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care", "attend_consultation", "doctor_note",
  // Care Circle P2 (2026-11-04)
  "investigation_status", "investigation_values", "weekly_weight_trend", "care_plan_progress",
] as const;
export type CirclePermission = (typeof CIRCLE_PERMISSIONS)[number];
export const GRANT_DAY_CHOICES = [30, 90, 365] as const;

const PERMISSION_KEYS: Readonly<Record<CirclePermission, MessageKey>> = {
  adherence_summary: "circle.perm.adherence_summary",
  weekly_bp_trend: "circle.perm.weekly_bp_trend",
  appointments: "circle.perm.appointments",
  red_alerts: "circle.perm.red_alerts",
  pay_for_care: "circle.perm.pay_for_care",
  attend_consultation: "consult.cg.perm",
  // 2026-11-03: the doctor's line for the family (outside `circle.` on purpose: pending CMO review)
  doctor_note: "familynote.perm",
  investigation_status: "circlep2.perm.investigation_status",
  investigation_values: "circlep2.perm.investigation_values",
  weekly_weight_trend: "circlep2.perm.weekly_weight_trend",
  care_plan_progress: "circlep2.perm.care_plan_progress",
};
export const permissionKey = (p: CirclePermission): MessageKey => PERMISSION_KEYS[p];

export interface CircleMember { memberId: string; name: string; relationship: string; permissions: CirclePermission[]; expiresAt: string; monthlyReportShared: boolean; missedDoseAlert: boolean }
export interface PendingInvite { inviteId: string; hint: string; relationship: string; expiresAt: string }
export interface CirclePause { pausedUntil: string; pauseAlerts: boolean }
/** Care Circle P1 (D3): a share with a person who paid, waiting for them to say yes. It grants nothing until they do. */
export interface PendingOffer { memberId: string; name: string; permissions: CirclePermission[]; answerBy: string }
export interface MyCircle { members: CircleMember[]; invites: PendingInvite[]; offers: PendingOffer[]; pause?: CirclePause; pauseDays?: number }
/** A supporter can drop the push for one person and keep the in-app request. No quiet hours: a request must never be hidden by the clock. */
export const ALERT_MODES = ["push_and_app", "app_only"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];
export interface SupportedPerson { patientId: string; memberId: string; name: string; relationship: string; permissions: CirclePermission[]; expiresAt: string; alertMode: AlertMode }
export interface OpenAlert { patientId: string; name: string; since: string; called: boolean }
export interface ViewLogRow { viewer: string; at: string }
export interface SupporterView {
  patientId: string;
  name: string;
  sharedUntil: string;
  adherence?: { taken: number; due: number; percent: number | null };
  bpTrend?: { weeks: { weekStart: string; systolic: number | null; diastolic: number | null; readings: number }[]; direction: "higher" | "lower" | "steady" | null };
  appointments?: { nextAt: string | null; missed30d: number };
  /** S38d: month by month, each part only with the matching tick. */
  monthly?: CircleMonthlyRow[];
  canPay: boolean;
  /** The doctor's line for the family: absent = not shared; null = shared but none written yet. The author is null-gated by the database. */
  doctorNote?: DoctorNote | null;
  // Care Circle P2: each absent = not shared. Everyday tests only; the database never sends a sensitive test or value.
  investigations?: InvestigationRow[];
  results?: ResultRow[];
  weightTrend?: { weeks: { weekStart: string; kg: number | null; readings: number }[]; direction: "higher" | "lower" | "steady" | null };
  planProgress?: { done: number; due: number; overdue: number; nextDue: string | null };
}
/** Care Circle P2: where one test has got to. Never a value. */
export const INVESTIGATION_STAGES = ["due", "overdue", "requested", "awaiting_result", "result_received", "awaiting_review", "reviewed", "done"] as const;
export type InvestigationStage = (typeof INVESTIGATION_STAGES)[number];
export interface InvestigationRow { code: string; stage: InvestigationStage; dueDate: string | null; followUp: boolean }
/** Care Circle P2 (D2): one reviewed, released value. `inRange` is null when the lab gave no range. */
export interface ResultRow { code: string; at: string; value: number | null; valueText: string | null; unit: string; refLow: number | null; refHigh: number | null; inRange: boolean | null }
export interface DoctorNote { body: string; writtenAt: string; authorStaffId: string | null; authorName: string | null }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isPermission = (x: unknown): x is CirclePermission => CIRCLE_PERMISSIONS.some((p) => p === x);

/** Every entry must be a known circle permission; one unknown value drops the whole row (it is not something this build understands). */
/** For an invitation, every permission must be known: the person is agreeing to see exactly these, so an older app says it cannot show it
 * rather than show a shorter list than the one they would be accepting. */
function permissionsStrict(x: unknown): CirclePermission[] | null {
  if (!Array.isArray(x)) return null;
  return x.every(isPermission) ? (x as CirclePermission[]) : null;
}

function permissions(x: unknown): CirclePermission[] | null {
  if (!Array.isArray(x)) return null;
  // a name this app does not know (a newer database, an older app) is dropped rather than hiding the whole person (Care Circle P2)
  return x.filter(isPermission);
}

export function parseMyCircle(data: unknown): MyCircle {
  const out: MyCircle = { members: [], invites: [], offers: [] };
  if (!isObj(data)) return out;
  if (Array.isArray(data["members"])) {
    for (const m of data["members"]) {
      if (!isObj(m)) continue;
      const perms = permissions(m["permissions"]);
      if (str(m["member_id"]) && str(m["name"]) && str(m["relationship"]) && perms && str(m["expires_at"])) {
        out.members.push({ memberId: m["member_id"], name: m["name"], relationship: m["relationship"], permissions: perms, expiresAt: m["expires_at"], monthlyReportShared: m["monthly_report_shared"] === true, missedDoseAlert: m["missed_dose_alert"] === true });
      }
    }
  }
  if (Array.isArray(data["offers"])) {
    for (const o of data["offers"]) {
      if (!isObj(o)) continue;
      const perms = permissions(o["permissions"]);
      if (str(o["member_id"]) && str(o["name"]) && perms && str(o["answer_by"])) out.offers.push({ memberId: o["member_id"], name: o["name"], permissions: perms, answerBy: o["answer_by"] });
    }
  }
  const p = data["pause"];
  if (isObj(p) && str(p["paused_until"]) && typeof p["pause_alerts"] === "boolean") out.pause = { pausedUntil: p["paused_until"], pauseAlerts: p["pause_alerts"] };
  if (num(data["pause_days"])) out.pauseDays = data["pause_days"];
  if (Array.isArray(data["invites"])) {
    for (const i of data["invites"]) {
      if (isObj(i) && str(i["invite_id"]) && str(i["hint"]) && str(i["relationship"]) && str(i["expires_at"])) {
        out.invites.push({ inviteId: i["invite_id"], hint: i["hint"], relationship: i["relationship"], expiresAt: i["expires_at"] });
      }
    }
  }
  return out;
}

export function parseSupported(data: unknown): SupportedPerson[] {
  if (!Array.isArray(data)) return [];
  const out: SupportedPerson[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const perms = permissions(r["permissions"]);
    if (str(r["patient_id"]) && str(r["member_id"]) && str(r["name"]) && str(r["relationship"]) && perms && str(r["expires_at"])) {
      out.push({ patientId: r["patient_id"], memberId: r["member_id"], name: r["name"], relationship: r["relationship"], permissions: perms, expiresAt: r["expires_at"], alertMode: r["alert_mode"] === "app_only" ? "app_only" : "push_and_app" });
    }
  }
  return out;
}

export function parseAlerts(data: unknown): OpenAlert[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["patient_id"]) && str(r["name"]) && str(r["since"]) ? [{ patientId: r["patient_id"], name: r["name"], since: r["since"], called: r["called"] === true }] : []));
}

export function parseViewLog(data: unknown): ViewLogRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["viewer"]) && str(r["at"]) ? [{ viewer: r["viewer"], at: r["at"] }] : []));
}

const direction = (d: unknown): "higher" | "lower" | "steady" | null => (d === "higher" || d === "lower" || d === "steady" ? d : null);

/** Null means the access has ended or never existed. Only the blocks the database sent are kept, field by field, so a stray field cannot leak onto the screen. */
export function parseSupporterView(data: unknown): SupporterView | null {
  if (!isObj(data) || !str(data["patient_id"]) || !str(data["name"]) || !str(data["shared_until"])) return null;
  const v: SupporterView = { patientId: data["patient_id"], name: data["name"], sharedUntil: data["shared_until"], canPay: data["can_pay"] === true };
  const a = data["adherence"];
  if (isObj(a) && num(a["taken"]) && num(a["due"])) v.adherence = { taken: a["taken"], due: a["due"], percent: num(a["percent"]) ? a["percent"] : null };
  const b = data["bp_trend"];
  if (isObj(b) && Array.isArray(b["weeks"])) {
    const weeks = b["weeks"].flatMap((w) =>
      isObj(w) && str(w["week_start"]) && num(w["readings"])
        ? [{ weekStart: w["week_start"], systolic: num(w["systolic"]) ? w["systolic"] : null, diastolic: num(w["diastolic"]) ? w["diastolic"] : null, readings: w["readings"] }]
        : [],
    );
    const d = b["direction"];
    v.bpTrend = { weeks, direction: direction(d) };
  }
  if (Array.isArray(data["investigations"])) {
    v.investigations = data["investigations"].flatMap((r): InvestigationRow[] => {
      if (!isObj(r) || !str(r["code"]) || typeof r["follow_up"] !== "boolean") return [];
      const stage = INVESTIGATION_STAGES.find((s) => s === r["stage"]);
      return stage ? [{ code: r["code"], stage, dueDate: str(r["due_date"]) ? r["due_date"] : null, followUp: r["follow_up"] }] : [];
    });
  }
  if (Array.isArray(data["results"])) {
    v.results = data["results"].flatMap((r): ResultRow[] => {
      if (!isObj(r) || !str(r["code"]) || !str(r["at"]) || !str(r["unit"])) return [];
      const value = num(r["value"]) ? r["value"] : null;
      const valueText = str(r["value_text"]) ? r["value_text"] : null;
      if (value === null && valueText === null) return [];
      return [{
        code: r["code"], at: r["at"], value, valueText, unit: r["unit"], refLow: num(r["ref_low"]) ? r["ref_low"] : null, refHigh: num(r["ref_high"]) ? r["ref_high"] : null,
        inRange: typeof r["in_range"] === "boolean" ? r["in_range"] : null,
      }];
    });
  }
  const wt = data["weight_trend"];
  if (isObj(wt) && Array.isArray(wt["weeks"])) {
    const weeks = wt["weeks"].flatMap((w) => (isObj(w) && str(w["week_start"]) && num(w["readings"]) ? [{ weekStart: w["week_start"], kg: num(w["kg"]) ? w["kg"] : null, readings: w["readings"] }] : []));
    v.weightTrend = { weeks, direction: direction(wt["direction"]) };
  }
  const pp = data["plan_progress"];
  if (isObj(pp) && num(pp["done"]) && num(pp["due"]) && num(pp["overdue"])) {
    v.planProgress = { done: pp["done"], due: pp["due"], overdue: pp["overdue"], nextDue: str(pp["next_due"]) ? pp["next_due"] : null };
  }
  if (Array.isArray(data["monthly"])) v.monthly = parseCircleMonthly(data["monthly"]);
  const p = data["appointments"];
  if (isObj(p) && num(p["missed_30d"])) v.appointments = { nextAt: str(p["next_at"]) ? p["next_at"] : null, missed30d: p["missed_30d"] };
  if (Object.prototype.hasOwnProperty.call(data, "doctor_note")) {
    const n = data["doctor_note"];
    if (n === null) v.doctorNote = null;
    else if (isObj(n) && str(n["body"]) && n["body"].length >= 1 && n["body"].length <= 280 && str(n["written_at"])) {
      v.doctorNote = { body: n["body"], writtenAt: n["written_at"], authorStaffId: str(n["author_staff_id"]) ? n["author_staff_id"] : null, authorName: str(n["author_name"]) ? n["author_name"] : null };
    }
  }
  return v;
}

/** The patient's own notes (my_family_notes): every note reaches the patient first; family sees one only after the patient shares it. */
export interface MyFamilyNote extends DoctorNote { noteId: string; shared: boolean; decided: boolean }
export function parseMyFamilyNotes(data: unknown): MyFamilyNote[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((n) =>
    isObj(n) && str(n["note_id"]) && str(n["body"]) && n["body"].length >= 1 && n["body"].length <= 280 && str(n["written_at"])
      && typeof n["shared"] === "boolean" && typeof n["decided"] === "boolean"
      ? [{
          noteId: n["note_id"], body: n["body"], writtenAt: n["written_at"],
          authorStaffId: str(n["author_staff_id"]) ? n["author_staff_id"] : null, authorName: str(n["author_name"]) ? n["author_name"] : null,
          shared: n["shared"], decided: n["decided"],
        }]
      : [],
  );
}

/** The name to show for a family note: only when the database sent both the author's id and name (null-gated, never invented). */
export function familyNoteAuthor(n: Pick<DoctorNote, "authorStaffId" | "authorName">): string | null {
  return n.authorStaffId && n.authorName ? n.authorName : null;
}

/**
 * Sharing with the person who paid (2026-11-03). Every circle permission except the per-call attend_consultation invitation (the
 * database refuses it here too). NOTHING is pre-ticked; "Share the usual" ticks exactly GIFT_SHARE_USUAL plus the monthly report.
 */
export const GIFT_SHARE_PERMISSIONS = ["weekly_bp_trend", "adherence_summary", "appointments", "red_alerts", "doctor_note", "pay_for_care"] as const satisfies readonly CirclePermission[];
export type GiftSharePermission = (typeof GIFT_SHARE_PERMISSIONS)[number];
export const GIFT_SHARE_USUAL: readonly GiftSharePermission[] = ["weekly_bp_trend", "adherence_summary", "appointments", "red_alerts"];
/** `offerPending` (P1, D3): the patient already asked this payer to join and is waiting for their answer. */
export interface GiftPayer { payerId: string; firstName: string | null; entitlementIds: string[]; offerPending: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (x: string): boolean => UUID.test(x);
export function parseGiftPayers(data: unknown): GiftPayer[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) =>
    isObj(r) && str(r["payer_id"]) && UUID.test(r["payer_id"]) && Array.isArray(r["entitlement_ids"]) && r["entitlement_ids"].every(str)
      ? [{ payerId: r["payer_id"], firstName: str(r["first_name"]) ? r["first_name"] : null, entitlementIds: r["entitlement_ids"] as string[], offerPending: r["offer_pending"] === true }]
      : [],
  );
}
/** A re-read adds newly eligible payers but never drops one already on screen, so an answered step keeps its confirmation in view. */
export function mergeKeepingShown(shown: readonly GiftPayer[], next: readonly GiftPayer[]): GiftPayer[] {
  const out = [...shown];
  for (const p of next) {
    const i = out.findIndex((x) => x.payerId === p.payerId);
    const cur = i === -1 ? undefined : out[i];
    if (cur === undefined) out.push(p);
    else out[i] = { ...cur, entitlementIds: [...new Set([...cur.entitlementIds, ...p.entitlementIds])], offerPending: p.offerPending };
  }
  return out;
}
/** What the share call may send: at least one permission, only offered ones, no repeats, a real payer id. Checked before sending. */
export function validGiftShare(payerId: string, permissions: readonly string[]): permissions is GiftSharePermission[] {
  return UUID.test(payerId) && permissions.length > 0 && new Set(permissions).size === permissions.length
    && permissions.every((p) => (GIFT_SHARE_PERMISSIONS as readonly string[]).includes(p));
}

/** True when the access ends within `days` days (the first notice window, 14 by default) and has not already ended. */
export function endsSoon(expiresAt: string, nowMs: number, days = 14): boolean {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) && end > nowMs && end - nowMs <= days * 24 * 60 * 60 * 1000;
}

/** What the patient sees when they preview a supporter's page: the same blocks (parsed by the same function), whether the check-in sample applies, and no end date before anyone is invited. */
export interface PreviewView extends SupporterView { alertSample: boolean }
export function parsePreviewView(data: unknown): PreviewView | null {
  if (!isObj(data) || data["preview"] !== true) return null;
  const v = parseSupporterView(isObj(data) && data["shared_until"] === null ? { ...data, shared_until: "" } : data);
  return v ? { ...v, alertSample: data["alert_sample"] === true } : null;
}
/** The renew and pause calls answer with an object; only a clean ok counts. */
export const parseOk = (data: unknown): boolean => isObj(data) && data["ok"] === true;
export const parsePaused = (data: unknown): boolean => isObj(data) && str(data["paused_until"]);

export type InviteMade = { ok: true; token: string; expiresAt: string } | { ok: false; errorKey: MessageKey };
export function parseInviteMade(data: unknown): { token: string; expiresAt: string } | null {
  return isObj(data) && str(data["token"]) && data["token"].length >= 20 && str(data["expires_at"]) ? { token: data["token"], expiresAt: data["expires_at"] } : null;
}

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  invite_rate_limited: "circle.error.invite_rate_limited",
  circle_full: "circle.error.circle_full",
  invite_self: "circle.error.invite_self",
  invite_contact_invalid: "circle.error.invite_contact_invalid",
  invite_permissions_invalid: "circle.error.invite_permissions_invalid",
  invite_relationship_invalid: "circle.error.invite_relationship_invalid",
  circle_not_authorised: "circle.error.circle_not_authorised",
};
export function circleErrorKey(message: unknown): MessageKey {
  if (!str(message)) return "circle.error.unknown";
  const hit = Object.keys(ERROR_KEYS).find((code) => message.includes(code));
  return (hit ? ERROR_KEYS[hit] : undefined) ?? "circle.error.unknown";
}

/** The link the patient shares: the token is in the path (so it survives a sign-in redirect) and nowhere else. */
export const inviteLinkPath = (token: string): string => `/patient/supporting/join/${encodeURIComponent(token)}`;

export interface PendingGift { entitlementId: string; nameKey: string; decideBy: string }
export function parsePendingGifts(data: unknown): PendingGift[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["entitlement_id"]) && str(r["name_key"]) && str(r["decide_by"]) ? [{ entitlementId: r["entitlement_id"], nameKey: r["name_key"], decideBy: r["decide_by"] }] : []));
}
/** Only a clean accepted or declined counts as saved; anything else (not found, pending, garbage) is "could not save". */
export function parseGiftAnswer(data: unknown): "accepted" | "declined" | null {
  return isObj(data) && (data["result"] === "accepted" || data["result"] === "declined") ? data["result"] : null;
}

/** S29e: what the join screen shows before the supporter accepts. `crossOrganisation` means payment is not on offer. */
export type InvitePreview = { ok: true; inviterFirstName: string; relationship: string; permissions: CirclePermission[]; crossOrganisation: boolean } | { ok: false };
export function parseInvitePreview(data: unknown): InvitePreview {
  if (!isObj(data) || data["ok"] !== true || !str(data["inviter_first_name"]) || !str(data["relationship"])) return { ok: false };
  const perms = permissionsStrict(data["permissions"]);
  if (!perms) return { ok: false };
  return { ok: true, inviterFirstName: data["inviter_first_name"], relationship: data["relationship"], permissions: perms, crossOrganisation: data["cross_organisation"] === true };
}
export function parseAcceptInvite(data: unknown): { ok: true; patientId: string } | { ok: false } {
  return isObj(data) && data["ok"] === true && str(data["patient_id"]) ? { ok: true, patientId: data["patient_id"] } : { ok: false };
}
/** A request for a check-in (S29e, non-emergency). `null` means the reply was not understood; the screen says so and never assumes success. */
export type CheckInResult = { ok: true; windowEndsAt: string } | { ok: false; reason: "limit" | "already_waiting" };
export function parseCheckInResult(data: unknown): CheckInResult | null {
  if (!isObj(data)) return null;
  if (data["ok"] === true && str(data["window_ends_at"])) return { ok: true, windowEndsAt: data["window_ends_at"] };
  if (data["ok"] === false && (data["reason"] === "limit" || data["reason"] === "already_waiting")) return { ok: false, reason: data["reason"] };
  return null;
}
export const parseCheckInPending = (data: unknown): boolean => isObj(data) && data["waiting"] === true;
/** People who need a supporter's attention: distinct people across open requests nobody has called about and unanswered check-ins. */
export const needsAttentionCount = (alerts: readonly OpenAlert[], unanswered: readonly { patientId: string }[] = []): number =>
  new Set([...alerts.filter((a) => !a.called).map((a) => a.patientId), ...unanswered.map((u) => u.patientId)]).size;

/** Whole minutes left in a window, never below one, from the end time the database sent (the length is configuration, not a constant here). */
export function minutesLeft(windowEndsAt: string, nowMs: number): number | null {
  const end = Date.parse(windowEndsAt);
  return Number.isFinite(end) ? Math.max(1, Math.round((end - nowMs) / 60_000)) : null;
}
/** People who did not answer a check-in in time: name and time only, like a red alert. A malformed row is dropped. */
export interface UnansweredCheckIn { patientId: string; name: string; since: string }
export function parseUnanswered(data: unknown): UnansweredCheckIn[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["patient_id"]) && str(r["name"]) && str(r["since"]) ? [{ patientId: r["patient_id"], name: r["name"], since: r["since"] }] : []));
}

// ---------------------------------------------------------------------------
// S69b: tools status, "not now", shared jobs, the weekly digest, nudges
// ---------------------------------------------------------------------------
export interface ToolsStatus { digest: boolean; tasks: boolean; missedDose: boolean; graceMinutes: number | null }
export const TOOLS_OFF: ToolsStatus = { digest: false, tasks: false, missedDose: false, graceMinutes: null };
/** A reply that is not understood means every tool is off: a control is never shown by accident. */
export function parseToolsStatus(data: unknown): ToolsStatus {
  if (!isObj(data)) return TOOLS_OFF;
  return { digest: data["digest"] === true, tasks: data["tasks"] === true, missedDose: data["missed_dose"] === true, graceMinutes: num(data["grace_minutes"]) ? data["grace_minutes"] : null };
}
export const parseDeclined = (data: unknown): boolean => isObj(data) && data["ok"] === true;

export type TaskAnswer = "can_help" | "cannot_help";
export interface CircleTask {
  taskId: string; kind: string; neededBy: string | null; state: "open" | "claimed" | "done"; claimedByName: string | null; mine: boolean;
  canClaim: boolean; canRelease: boolean; canComplete: boolean; canCancel: boolean;
  /** Care Circle P3: the patient's note (D4), whether it was addressed to the caller, and (patient only) who it went to and their answers. */
  note: string | null; addressed: boolean; recipients: { name: string; answer: TaskAnswer | null }[] | null; myAnswer: TaskAnswer | null; canDecline: boolean;
}
const taskAnswer = (x: unknown): TaskAnswer | null => (x === "can_help" || x === "cannot_help" ? x : null);
export interface CircleTaskList { role: "patient" | "helper" | "viewer"; tasks: CircleTask[] }
export function parseTasks(data: unknown): CircleTaskList | null {
  if (!isObj(data) || !Array.isArray(data["tasks"])) return null;
  const role = data["role"];
  if (role !== "patient" && role !== "helper" && role !== "viewer") return null;
  const tasks = data["tasks"].flatMap((r): CircleTask[] => {
    if (!isObj(r) || !str(r["task_id"]) || !str(r["kind"])) return [];
    const state = r["state"];
    if (state !== "open" && state !== "claimed" && state !== "done") return [];
    return [{
      taskId: r["task_id"], kind: r["kind"], neededBy: str(r["needed_by"]) ? r["needed_by"] : null, state, claimedByName: str(r["claimed_by_name"]) ? r["claimed_by_name"] : null,
      mine: r["mine"] === true, canClaim: r["can_claim"] === true, canRelease: r["can_release"] === true, canComplete: r["can_complete"] === true, canCancel: r["can_cancel"] === true,
      note: str(r["note"]) && r["note"].length > 0 ? r["note"] : null,
      addressed: r["addressed"] === true,
      recipients: Array.isArray(r["recipients"]) ? r["recipients"].flatMap((x) => (isObj(x) && str(x["name"]) ? [{ name: x["name"], answer: taskAnswer(x["answer"]) }] : [])) : null,
      myAnswer: taskAnswer(r["my_answer"]),
      canDecline: r["can_decline"] === true,
    }];
  });
  return { role, tasks };
}

export interface CircleDigest {
  name: string; days: number;
  doses?: { daysAllTaken: number; daysWithDoses: number };
  readings?: { daysLogged: number };
  nextAppointmentAt?: string | null;
  tasks?: { open: number; claimed: number; done: number };
}
/** Field by field, so a stray field can never reach the screen; a block that is absent stays absent. */
export function parseDigest(data: unknown): CircleDigest | null {
  if (!isObj(data) || !str(data["name"]) || !num(data["days"])) return null;
  const d: CircleDigest = { name: data["name"], days: data["days"] };
  const doses = data["doses"];
  if (isObj(doses) && num(doses["days_all_taken"]) && num(doses["days_with_doses"])) d.doses = { daysAllTaken: doses["days_all_taken"], daysWithDoses: doses["days_with_doses"] };
  const readings = data["readings"];
  if (isObj(readings) && num(readings["days_logged"])) d.readings = { daysLogged: readings["days_logged"] };
  const appts = data["appointments"];
  if (isObj(appts)) d.nextAppointmentAt = str(appts["next_at"]) ? appts["next_at"] : null;
  const tasks = data["tasks"];
  if (isObj(tasks) && num(tasks["open"]) && num(tasks["claimed"]) && num(tasks["done"])) d.tasks = { open: tasks["open"], claimed: tasks["claimed"], done: tasks["done"] };
  return d;
}

export interface CircleNudge { patientId: string; name: string; since: string }
export function parseNudges(data: unknown): CircleNudge[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["patient_id"]) && str(r["name"]) && str(r["since"]) ? [{ patientId: r["patient_id"], name: r["name"], since: r["since"] }] : []));
}

// ---------------------------------------------------------------------------
// Care Circle P1 (founder decision D3, 2026-11-04): a person who paid is asked to join, and says yes or no
// ---------------------------------------------------------------------------
/** An offer to join someone's Care Circle, as the payer sees it. First name only. Unknown permission names are dropped, never the row. */
export interface ShareOffer { memberId: string; patientId: string; name: string; permissions: CirclePermission[]; monthlyReport: boolean; offeredAt: string; answerBy: string }
export function parseShareOffers(data: unknown): ShareOffer[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r): ShareOffer[] => {
    if (!isObj(r)) return [];
    const perms = permissions(r["permissions"]);
    return str(r["member_id"]) && UUID.test(r["member_id"]) && str(r["patient_id"]) && str(r["name"]) && perms && str(r["offered_at"]) && str(r["answer_by"])
      ? [{ memberId: r["member_id"], patientId: r["patient_id"], name: r["name"], permissions: perms, monthlyReport: r["monthly_report"] === true, offeredAt: r["offered_at"], answerBy: r["answer_by"] }]
      : [];
  });
}
/** respond_to_circle_share_offer: only a clean `{ok: true, accepted}` counts; anything else is "not saved". */
export function parseRespondOffer(data: unknown): { accepted: boolean } | null {
  return isObj(data) && data["ok"] === true && typeof data["accepted"] === "boolean" ? { accepted: data["accepted"] } : null;
}
/** share_circle_with_gift_payer: `offered` true means the payer must say yes first; false means an existing member now sees more. */
export function parseGiftShareResult(data: unknown): { offered: boolean } | null {
  return isObj(data) && data["ok"] === true ? { offered: data["offered"] === true } : null;
}

/** P1: one change in the patient's history of who may see what. Written only by the database. */
export const SHARING_CHANGES = [
  "added", "offered", "accepted", "declined", "withdrawn", "offer_lapsed", "permissions_changed", "renewed", "revoked", "expired",
  "monthly_report_on", "monthly_report_off", "missed_dose_alert_on", "missed_dose_alert_off",
  "paused", "resumed", "doctor_note_shared", "doctor_note_withdrawn",
] as const;
export type SharingChange = (typeof SHARING_CHANGES)[number];
export interface SharingHistoryRow { at: string; changes: SharingChange[]; by: "patient" | "supporter" | "system"; supporter: string | null }
/** A change this app does not know is dropped; a row is dropped only when none of its changes are known. */
export function parseSharingHistory(data: unknown): SharingHistoryRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r): SharingHistoryRow[] => {
    if (!isObj(r) || !str(r["at"]) || !Array.isArray(r["changes"])) return [];
    const by = r["by"];
    if (by !== "patient" && by !== "supporter" && by !== "system") return [];
    const changes = r["changes"].flatMap((c): SharingChange[] => {
      const hit = SHARING_CHANGES.find((k) => k === c);
      return hit ? [hit] : [];
    });
    return changes.length > 0 ? [{ at: r["at"], changes, by, supporter: str(r["supporter"]) ? r["supporter"] : null }] : [];
  });
}
const SHARING_CHANGE_KEYS = {
  added: "circlep1.history.added",
  offered: "circlep1.history.offered",
  accepted: "circlep1.history.accepted",
  declined: "circlep1.history.declined",
  withdrawn: "circlep1.history.withdrawn",
  offer_lapsed: "circlep1.history.offer_lapsed",
  permissions_changed: "circlep1.history.permissions_changed",
  renewed: "circlep1.history.renewed",
  revoked: "circlep1.history.revoked",
  expired: "circlep1.history.expired",
  monthly_report_on: "circlep1.history.monthly_report_on",
  monthly_report_off: "circlep1.history.monthly_report_off",
  missed_dose_alert_on: "circlep1.history.missed_dose_alert_on",
  missed_dose_alert_off: "circlep1.history.missed_dose_alert_off",
  paused: "circlep1.history.paused",
  resumed: "circlep1.history.resumed",
  doctor_note_shared: "circlep1.history.doctor_note_shared",
  doctor_note_withdrawn: "circlep1.history.doctor_note_withdrawn",
} as const satisfies Record<SharingChange, MessageKey>;
/** The copy key for one change, exactly as the web maps it: a removal made by the supporter themself reads "left". */
export function sharingChangeKey(change: SharingChange, by: SharingHistoryRow["by"]): MessageKey {
  if (change === "revoked" && by === "supporter") return "circlep1.history.left";
  return SHARING_CHANGE_KEYS[change];
}
