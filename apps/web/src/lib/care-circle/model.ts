import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Care Circle screens read from the database (S29). Every reply is parsed, never trusted: a shape that does not match is
 * treated as "nothing to show" rather than rendered half-wrong. The supporter view is the only thing a supporter can read about a
 * patient; the database sends a block only when the matching permission is held, so a missing block means "not shared", never "zero".
 */
export const CIRCLE_PERMISSIONS = [
  "adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care", "attend_consultation", "doctor_note",
  // Care Circle P2 (2026-11-04)
  "investigation_status", "investigation_values", "weekly_weight_trend", "care_plan_progress",
] as const;
export type CirclePermission = (typeof CIRCLE_PERMISSIONS)[number];
export const permissionSchema = z.enum(CIRCLE_PERMISSIONS);
/**
 * A permission list from the database. A name this app does not know (a newer database, an older app) is dropped rather than failing the
 * whole row: one unknown tick must never make a member or a supported person vanish from the screen.
 */
export const permissionListSchema = z
  .array(z.string())
  .transform((ps) => ps.filter((p): p is CirclePermission => (CIRCLE_PERMISSIONS as readonly string[]).includes(p)));

const PERMISSION_KEYS: Readonly<Record<CirclePermission, MessageKey>> = {
  adherence_summary: "circle.perm.adherence_summary",
  weekly_bp_trend: "circle.perm.weekly_bp_trend",
  appointments: "circle.perm.appointments",
  red_alerts: "circle.perm.red_alerts",
  pay_for_care: "circle.perm.pay_for_care",
  // CGJ: lives outside the `circle` namespace on purpose (the reviewed-strings ledger covers `circle.*`); see OQ-CGJ-5
  attend_consultation: "consult.cg.perm",
  // 2026-11-03: the doctor's line for the family; outside the `circle` namespace for the same reason (pending CMO review)
  doctor_note: "familynote.perm",
  // Care Circle P2: pending CMO/DPO review (family-circle-copy.ts)
  investigation_status: "circlep2.perm.investigation_status",
  investigation_values: "circlep2.perm.investigation_values",
  weekly_weight_trend: "circlep2.perm.weekly_weight_trend",
  care_plan_progress: "circlep2.perm.care_plan_progress",
};
export const permissionKey = (p: CirclePermission): MessageKey => PERMISSION_KEYS[p];

/** How long a grant can last, in days. The database allows 1 to 1095; these are the choices offered. */
export const GRANT_DAY_CHOICES = [30, 90, 365] as const;

export const memberSchema = z.object({
  member_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  permissions: permissionListSchema,
  expires_at: z.string(),
  since: z.string(),
  /** S75 A5: the patient chose to share the monthly report with this supporter. Absent means off. */
  monthly_report_shared: z.boolean().optional().default(false),
  /** S69b: the patient chose to let this supporter be nudged. Absent means off. */
  missed_dose_alert: z.boolean().optional().default(false),
  /** P4: main or backup family contact. A label only: it grants nothing. */
  contact_role: z.enum(["primary", "backup"]).nullable().optional().default(null),
});
export type CircleMember = z.infer<typeof memberSchema>;

export const pendingInviteSchema = z.object({
  invite_id: z.string(),
  hint: z.string(),
  kind: z.enum(["phone", "email"]),
  relationship: z.string(),
  permissions: permissionListSchema,
  expires_at: z.string(),
  /** S69b: always "waiting" for the sender, whether the other person has not answered or quietly said not now. */
  state: z.string().optional(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

/** A pause the patient started (S29c). Null or absent means sharing is on. */
export const pauseSchema = z.object({ paused_until: z.string(), pause_alerts: z.boolean() });
export type CirclePause = z.infer<typeof pauseSchema>;

/** Care Circle P1 (D3): a share with a person who paid, waiting for them to say yes. It grants nothing until they do. */
export const pendingOfferSchema = z.object({
  member_id: z.string(),
  name: z.string(),
  permissions: permissionListSchema,
  answer_by: z.string(),
});
export type PendingOffer = z.infer<typeof pendingOfferSchema>;

export const myCircleSchema = z.object({
  members: z.array(memberSchema),
  invites: z.array(pendingInviteSchema),
  /** P1: absent on a database without the migration, so it defaults to none. */
  offers: z.array(pendingOfferSchema).optional().default([]),
  pause: pauseSchema.nullable().optional(),
  pause_days: z.number().optional(),
});
export type MyCircle = z.infer<typeof myCircleSchema>;
export const EMPTY_CIRCLE: MyCircle = { members: [], invites: [], offers: [] };

export function parseMyCircle(data: unknown): MyCircle {
  const r = myCircleSchema.safeParse(data);
  return r.success ? r.data : EMPTY_CIRCLE;
}

/** A supporter can drop the push for one person and keep the in-app request. There are no quiet hours: a request must never be hidden by the clock. */
export const ALERT_MODES = ["push_and_app", "app_only"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export const supportedPersonSchema = z.object({
  patient_id: z.string(),
  member_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  permissions: permissionListSchema,
  expires_at: z.string(),
  alert_mode: z.enum(ALERT_MODES).catch("push_and_app"),
});
export type SupportedPerson = z.infer<typeof supportedPersonSchema>;

export function parseSupported(data: unknown): SupportedPerson[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = supportedPersonSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

/** One short line a doctor wrote for the family. `author_name` is sent only when the author is an active, named clinician. */
export const doctorNoteSchema = z.object({
  body: z.string().min(1).max(280),
  written_at: z.string(),
  author_staff_id: z.string().nullable(),
  author_name: z.string().nullable(),
});
export type DoctorNote = z.infer<typeof doctorNoteSchema>;

/** Care Circle P2: where one test has got to. Never a value. */
export const INVESTIGATION_STAGES = ["due", "overdue", "requested", "awaiting_result", "result_received", "awaiting_review", "reviewed", "done"] as const;
export const investigationRowSchema = z.object({
  code: z.string(),
  stage: z.enum(INVESTIGATION_STAGES),
  due_date: z.string().nullable(),
  follow_up: z.boolean(),
});
export type InvestigationRow = z.infer<typeof investigationRowSchema>;
/** Care Circle P2 (D2): one reviewed, released value. `in_range` is null when the lab gave no range. */
export const resultRowSchema = z.object({
  code: z.string(),
  at: z.string(),
  value: z.number().nullable(),
  value_text: z.string().nullable(),
  unit: z.string(),
  ref_low: z.number().nullable(),
  ref_high: z.number().nullable(),
  in_range: z.boolean().nullable(),
});
export type ResultRow = z.infer<typeof resultRowSchema>;

export const supporterViewSchema = z.object({
  patient_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  permissions: permissionListSchema,
  shared_until: z.string(),
  adherence: z.object({ days: z.number(), taken: z.number(), due: z.number(), percent: z.number().nullable() }).optional(),
  bp_trend: z
    .object({
      weeks: z.array(z.object({ week_start: z.string(), systolic: z.number().nullable(), diastolic: z.number().nullable(), readings: z.number() })),
      direction: z.enum(["higher", "lower", "steady"]).nullable(),
    })
    .optional(),
  appointments: z.object({ next_at: z.string().nullable(), missed_30d: z.number() }).optional(),
  // S38d: monthly summary, parts present only with the matching tick; parsed field by field in @tarragon/i18n (parseCircleMonthly).
  monthly: z.array(z.unknown()).optional(),
  can_pay: z.boolean().optional(),
  /** The doctor's line for the family: absent = not shared; null = shared but none written yet. The author is null-gated by the database. */
  doctor_note: doctorNoteSchema.nullable().optional(),
  // Care Circle P2: each absent = not shared. Everyday tests only; the database never sends a sensitive test or value.
  investigations: z.array(investigationRowSchema).optional(),
  results: z.array(resultRowSchema).optional(),
  weight_trend: z
    .object({
      weeks: z.array(z.object({ week_start: z.string(), kg: z.number().nullable(), readings: z.number() })),
      direction: z.enum(["higher", "lower", "steady"]).nullable(),
    })
    .optional(),
  plan_progress: z.object({ done: z.number(), due: z.number(), overdue: z.number(), next_due: z.string().nullable() }).optional(),
  /** P4: this supporter is the patient's main or backup family contact (a label only). */
  contact_role: z.enum(["primary", "backup"]).nullable().optional(),
});

/** P4: one event on the family timeline. Never a value or free text; `code` is a test code or a help-request kind. */
export const TIMELINE_KINDS = [
  "doctor_note_shared", "appointment_attended", "appointment_missed", "test_requested", "test_reviewed", "help_requested", "help_done",
] as const;
export const timelineEventSchema = z.object({
  at: z.string(),
  kind: z.enum(TIMELINE_KINDS),
  code: z.string().optional(),
  source: z.enum(["clinician", "patient", "system"]),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export function parseTimeline(data: unknown): TimelineEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = timelineEventSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export type SupporterView = z.infer<typeof supporterViewSchema>;

/** Null means the access has ended or never existed: the screen shows one neutral message either way. */
export function parseSupporterView(data: unknown): SupporterView | null {
  const r = supporterViewSchema.safeParse(data);
  return r.success ? r.data : null;
}

export const openAlertSchema = z.object({ patient_id: z.string(), name: z.string(), since: z.string(), called: z.boolean().catch(false) });
export type OpenAlert = z.infer<typeof openAlertSchema>;
export function parseOpenAlerts(data: unknown): OpenAlert[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = openAlertSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

/** What the patient sees when they preview a supporter's page: the same blocks, a null end date before anyone is invited, and whether a check-in request was ticked. */
export const previewViewSchema = supporterViewSchema.extend({ shared_until: z.string().nullable(), preview: z.literal(true), alert_sample: z.boolean() });
export type PreviewView = z.infer<typeof previewViewSchema>;
export function parsePreviewView(data: unknown): PreviewView | null {
  const r = previewViewSchema.safeParse(data);
  return r.success ? r.data : null;
}

export const renewSchema = z.object({ ok: z.boolean() });
export const pauseResultSchema = z.object({ paused_until: z.string(), pause_alerts: z.boolean() });

/** True when the access ends within `days` days (the first notice window, 14 by default) and has not already ended. */
export function endsSoon(expiresAt: string, nowMs: number, days = 14): boolean {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) && end > nowMs && end - nowMs <= days * 24 * 60 * 60 * 1000;
}

export const viewLogRowSchema = z.object({ viewer: z.string(), at: z.string() });
export type ViewLogRow = z.infer<typeof viewLogRowSchema>;
export function parseViewLog(data: unknown): ViewLogRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = viewLogRowSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export const inviteMadeSchema = z.object({ invite_id: z.string(), token: z.string().min(20), expires_at: z.string(), grant_days: z.number() });
export const previewSchema = z.union([
  z.object({
    ok: z.literal(true),
    inviter_first_name: z.string(),
    relationship: z.string(),
    // strict on purpose: the person is agreeing to exactly these, so an unknown one fails the preview rather than showing a shorter list
    permissions: z.array(permissionSchema),
    grant_days: z.number(),
    expires_at: z.string(),
    /** S29e: the supporter's organisation differs from the patient's, so payment is not on offer. */
    cross_organisation: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false) }),
]);
export type InvitePreview = z.infer<typeof previewSchema>;
export function parsePreview(data: unknown): InvitePreview {
  const r = previewSchema.safeParse(data);
  return r.success ? r.data : { ok: false };
}
export const acceptSchema = z.union([z.object({ ok: z.literal(true), patient_id: z.string(), member_id: z.string() }), z.object({ ok: z.literal(false) })]);
export function parseAccept(data: unknown): z.infer<typeof acceptSchema> {
  const r = acceptSchema.safeParse(data);
  return r.success ? r.data : { ok: false };
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
/** The i18n key for a database refusal. The database raises a bare code; anything unrecognised is the generic message. */
export function circleErrorKey(message: unknown): MessageKey {
  if (typeof message !== "string") return "circle.error.unknown";
  const hit = Object.keys(ERROR_KEYS).find((code) => message.includes(code));
  return (hit ? ERROR_KEYS[hit] : undefined) ?? "circle.error.unknown";
}

/** The link the patient shares. The token is in the path (so it survives the sign-in redirect) and nowhere else. */
export function inviteLinkPath(token: string): string {
  return `/patient/supporting/join/${encodeURIComponent(token)}`;
}

export const pendingGiftSchema = z.object({ entitlement_id: z.string(), name_key: z.string(), paid_at: z.string().nullable(), decide_by: z.string() });
export type PendingGift = z.infer<typeof pendingGiftSchema>;
export function parsePendingGifts(data: unknown): PendingGift[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = pendingGiftSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export const giftResultSchema = z.object({ result: z.enum(["accepted", "declined", "pending", "not_needed", "not_found"]) });
export function parseGiftResult(data: unknown): "accepted" | "declined" | "other" {
  const r = giftResultSchema.safeParse(data);
  return r.success && (r.data.result === "accepted" || r.data.result === "declined") ? r.data.result : "other";
}

/**
 * Sharing with the person who paid (2026-11-03). The permissions offered at gift acceptance: every circle permission except the per-call
 * attend_consultation invitation (the database refuses it on this path too). NOTHING is pre-ticked; "Share the usual" ticks exactly
 * GIFT_SHARE_USUAL plus the monthly report.
 */
export const GIFT_SHARE_PERMISSIONS = ["weekly_bp_trend", "adherence_summary", "appointments", "red_alerts", "doctor_note", "pay_for_care"] as const satisfies readonly CirclePermission[];
export type GiftSharePermission = (typeof GIFT_SHARE_PERMISSIONS)[number];
export const GIFT_SHARE_USUAL: readonly GiftSharePermission[] = ["weekly_bp_trend", "adherence_summary", "appointments", "red_alerts"];

export const giftPayerSchema = z.object({
  payer_id: z.string().uuid(),
  first_name: z.string().nullable(),
  entitlement_ids: z.array(z.string()),
  last_gift_at: z.string().nullable(),
  is_member: z.boolean(),
  /** P1 (D3): the patient already asked this payer to join and is waiting for their answer. */
  offer_pending: z.boolean().optional().default(false),
});
export type GiftPayer = z.infer<typeof giftPayerSchema>;
export function parseGiftPayers(data: unknown): GiftPayer[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = giftPayerSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
/** The payer of one accepted gift, if they are still waiting for the patient's choice. */
export function payerForEntitlement(payers: readonly GiftPayer[], entitlementId: string): GiftPayer | null {
  return payers.find((p) => p.entitlement_ids.includes(entitlementId)) ?? null;
}

/**
 * The patient's own notes from the doctor (my_family_notes): every note reaches the patient first, and family sees one only after the
 * patient shares it. `decided` means the patient has answered (share or don't share). The author is null-gated by the database.
 */
export const myFamilyNoteSchema = z.object({
  note_id: z.string().uuid(),
  body: z.string().min(1).max(280),
  written_at: z.string(),
  author_staff_id: z.string().nullable(),
  author_name: z.string().nullable(),
  shared: z.boolean(),
  decided: z.boolean(),
});
export type MyFamilyNote = z.infer<typeof myFamilyNoteSchema>;
export function parseMyFamilyNotes(data: unknown): MyFamilyNote[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = myFamilyNoteSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export const familyNoteShareInputSchema = z.object({ noteId: z.string().uuid(), share: z.boolean() });

/** What the share call takes. Validated before anything is sent: at least one permission, none outside the offered list, no repeats. */
export const giftShareInputSchema = z.object({
  payerId: z.string().uuid(),
  permissions: z
    .array(z.enum(GIFT_SHARE_PERMISSIONS))
    .min(1)
    .refine((ps) => new Set(ps).size === ps.length, { message: "duplicate" }),
  monthlyReport: z.boolean(),
});
export type GiftShareInput = z.infer<typeof giftShareInputSchema>;
export const giftShareResultSchema = z.object({
  ok: z.literal(true),
  member_id: z.string(),
  created: z.boolean(),
  changed: z.boolean(),
  /** P1 (D3): true when the share is an offer the payer must accept (no active membership yet). */
  offered: z.boolean().optional().default(false),
});

/** P1 (D3): an offer to join someone's Care Circle, as the payer sees it. First name only. */
export const shareOfferSchema = z.object({
  member_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  name: z.string(),
  permissions: z.array(z.string()),
  monthly_report: z.boolean(),
  offered_at: z.string(),
  answer_by: z.string(),
});
export type ShareOffer = z.infer<typeof shareOfferSchema>;
export function parseShareOffers(data: unknown): ShareOffer[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = shareOfferSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export const respondOfferInputSchema = z.object({ memberId: z.string().uuid(), accept: z.boolean() });
export const respondOfferResultSchema = z.object({ ok: z.literal(true), accepted: z.boolean() });

/** P1: one change in the patient's history of who may see what. Written only by the database. */
export const SHARING_CHANGES = [
  "added", "offered", "accepted", "declined", "withdrawn", "offer_lapsed", "permissions_changed", "renewed", "revoked", "expired",
  "monthly_report_on", "monthly_report_off", "missed_dose_alert_on", "missed_dose_alert_off",
  "paused", "resumed", "doctor_note_shared", "doctor_note_withdrawn",
] as const;
export type SharingChange = (typeof SHARING_CHANGES)[number];
export const sharingHistoryRowSchema = z.object({
  at: z.string(),
  changes: z.array(z.enum(SHARING_CHANGES)).min(1),
  by: z.enum(["patient", "supporter", "system"]),
  supporter: z.string().nullable(),
});
export type SharingHistoryRow = z.infer<typeof sharingHistoryRowSchema>;
export function parseSharingHistory(data: unknown): SharingHistoryRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = sharingHistoryRowSchema.safeParse(row);
    return r.success ? [r.data] : [];
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
} as const satisfies Record<SharingChange, string>;
/**
 * The copy key for one change. A removal made by the supporter themself is "left"; everything else reads the same whoever did it
 * (the patient sees their own history, so "you" is implied where the patient acted).
 */
export function sharingChangeKey(change: SharingChange, by: SharingHistoryRow["by"]): (typeof SHARING_CHANGE_KEYS)[SharingChange] | "circlep1.history.left" {
  if (change === "revoked" && by === "supporter") return "circlep1.history.left";
  return SHARING_CHANGE_KEYS[change];
}

/** S29e: a supporter's non-emergency check-in request. `reason` is only ever one of these two (the database says nothing else). */
export const checkInRequestSchema = z.union([
  z.object({ ok: z.literal(true), window_ends_at: z.string() }),
  z.object({ ok: z.literal(false), reason: z.enum(["limit", "already_waiting"]) }),
]);
export type CheckInRequestResult = z.infer<typeof checkInRequestSchema>;
export function parseCheckInRequest(data: unknown): CheckInRequestResult | null {
  const r = checkInRequestSchema.safeParse(data);
  return r.success ? r.data : null;
}
/** The patient's own view of a waiting question. A reply that does not parse means "nothing waiting"; the screen never invents one. */
export function parseCheckInPending(data: unknown): boolean {
  const r = z.object({ waiting: z.boolean() }).safeParse(data);
  return r.success && r.data.waiting;
}

/** S29e: people who did not answer a check-in in time. Name only, like a red alert: no reading, no cause. */
const unansweredSchema = z.object({ patient_id: z.string(), name: z.string(), since: z.string() });
export type UnansweredCheckIn = z.infer<typeof unansweredSchema>;
export function parseUnanswered(data: unknown): UnansweredCheckIn[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = unansweredSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
/** Whole minutes left in a window, never below one, from the end time the database sent. The length is configuration: no number is invented when the time cannot be read. */
export function minutesLeft(windowEndsAt: string, nowMs: number): number | null {
  const end = Date.parse(windowEndsAt);
  return Number.isFinite(end) ? Math.max(1, Math.round((end - nowMs) / 60_000)) : null;
}

/** People who need a supporter's attention: distinct people across open check-in requests nobody has called about and unanswered check-ins. */
export function attentionCount(alerts: readonly { patient_id: string; called: boolean }[], unanswered: readonly { patient_id: string }[]): number {
  return new Set([...alerts.filter((a) => !a.called).map((a) => a.patient_id), ...unanswered.map((u) => u.patient_id)]).size;
}

/**
 * The database function is not there (yet). The app ships before its migration is applied, so a missing function must read as "this
 * feature is not available", never as a failure shown to every patient. Any other error is still a failure.
 */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? ""));
}


/** S69b: which supporter tools are switched on, and the wait before a nudge (from configuration, never typed into a screen). */
export const toolsStatusSchema = z.object({ digest: z.boolean(), tasks: z.boolean(), missed_dose: z.boolean(), grace_minutes: z.number().nullable().optional() });
export type ToolsStatus = z.infer<typeof toolsStatusSchema>;
export const TOOLS_OFF: ToolsStatus = { digest: false, tasks: false, missed_dose: false, grace_minutes: null };
export function parseToolsStatus(data: unknown): ToolsStatus {
  const r = toolsStatusSchema.safeParse(data);
  return r.success ? r.data : TOOLS_OFF;
}

/** The silent answer to "not now": the same shape as accept's failure on purpose. */
export function parseDeclined(data: unknown): boolean {
  return z.object({ ok: z.literal(true) }).safeParse(data).success;
}

export const taskSchema = z.object({
  task_id: z.string(),
  kind: z.string(),
  needed_by: z.string().nullable(),
  state: z.enum(["open", "claimed", "done"]),
  claimed_by_name: z.string().nullable().optional(),
  // Care Circle P3: the patient's note (D4), whether it was addressed, and (patient only) who it went to and their answers
  note: z.string().nullable().optional(),
  addressed: z.boolean().catch(false),
  recipients: z.array(z.object({ name: z.string(), answer: z.enum(["can_help", "cannot_help"]).nullable() })).nullable().optional(),
  my_answer: z.enum(["can_help", "cannot_help"]).nullable().optional(),
  can_decline: z.boolean().catch(false),
  mine: z.boolean().catch(false),
  posted_by_me: z.boolean().catch(false),
  can_claim: z.boolean().catch(false),
  can_release: z.boolean().catch(false),
  can_complete: z.boolean().catch(false),
  can_cancel: z.boolean().catch(false),
});
export type CircleTask = z.infer<typeof taskSchema>;
export const taskListSchema = z.object({ role: z.enum(["patient", "helper", "viewer"]), tasks: z.array(z.unknown()) });
export function parseTasks(data: unknown): { role: "patient" | "helper" | "viewer"; tasks: CircleTask[] } | null {
  const r = taskListSchema.safeParse(data);
  if (!r.success) return null;
  return {
    role: r.data.role,
    tasks: r.data.tasks.flatMap((row) => {
      const t = taskSchema.safeParse(row);
      return t.success ? [t.data] : [];
    }),
  };
}

export const digestSchema = z.object({
  patient_id: z.string(),
  name: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.number(),
  doses: z.object({ days_all_taken: z.number(), days_with_doses: z.number() }).optional(),
  readings: z.object({ days_logged: z.number() }).optional(),
  appointments: z.object({ next_at: z.string().nullable() }).optional(),
  tasks: z.object({ open: z.number(), claimed: z.number(), done: z.number() }).optional(),
});
export type CircleDigest = z.infer<typeof digestSchema>;
export function parseDigest(data: unknown): CircleDigest | null {
  const r = digestSchema.safeParse(data);
  return r.success ? r.data : null;
}

const nudgeSchema = z.object({ patient_id: z.string(), name: z.string(), since: z.string() });
export type CircleNudge = z.infer<typeof nudgeSchema>;
export function parseNudges(data: unknown): CircleNudge[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = nudgeSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export function taskErrorIsLimit(message: unknown): boolean {
  return typeof message === "string" && message.includes("task_limit");
}
