import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Care Circle screens read from the database (S29). Every reply is parsed, never trusted: a shape that does not match is
 * treated as "nothing to show" rather than rendered half-wrong. The supporter view is the only thing a supporter can read about a
 * patient; the database sends a block only when the matching permission is held, so a missing block means "not shared", never "zero".
 */
export const CIRCLE_PERMISSIONS = ["adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care", "attend_consultation"] as const;
export type CirclePermission = (typeof CIRCLE_PERMISSIONS)[number];
export const permissionSchema = z.enum(CIRCLE_PERMISSIONS);

const PERMISSION_KEYS: Readonly<Record<CirclePermission, MessageKey>> = {
  adherence_summary: "circle.perm.adherence_summary",
  weekly_bp_trend: "circle.perm.weekly_bp_trend",
  appointments: "circle.perm.appointments",
  red_alerts: "circle.perm.red_alerts",
  pay_for_care: "circle.perm.pay_for_care",
  // CGJ: lives outside the `circle` namespace on purpose (the reviewed-strings ledger covers `circle.*`); see OQ-CGJ-5
  attend_consultation: "consult.cg.perm",
};
export const permissionKey = (p: CirclePermission): MessageKey => PERMISSION_KEYS[p];

/** How long a grant can last, in days. The database allows 1 to 1095; these are the choices offered. */
export const GRANT_DAY_CHOICES = [30, 90, 365] as const;

export const memberSchema = z.object({
  member_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  permissions: z.array(permissionSchema),
  expires_at: z.string(),
  since: z.string(),
  /** S75 A5: the patient chose to share the monthly report with this supporter. Absent means off. */
  monthly_report_shared: z.boolean().optional().default(false),
  /** S69b: the patient chose to let this supporter be nudged. Absent means off. */
  missed_dose_alert: z.boolean().optional().default(false),
});
export type CircleMember = z.infer<typeof memberSchema>;

export const pendingInviteSchema = z.object({
  invite_id: z.string(),
  hint: z.string(),
  kind: z.enum(["phone", "email"]),
  relationship: z.string(),
  permissions: z.array(permissionSchema),
  expires_at: z.string(),
  /** S69b: always "waiting" for the sender, whether the other person has not answered or quietly said not now. */
  state: z.string().optional(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

/** A pause the patient started (S29c). Null or absent means sharing is on. */
export const pauseSchema = z.object({ paused_until: z.string(), pause_alerts: z.boolean() });
export type CirclePause = z.infer<typeof pauseSchema>;

export const myCircleSchema = z.object({ members: z.array(memberSchema), invites: z.array(pendingInviteSchema), pause: pauseSchema.nullable().optional(), pause_days: z.number().optional() });
export type MyCircle = z.infer<typeof myCircleSchema>;
export const EMPTY_CIRCLE: MyCircle = { members: [], invites: [] };

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
  permissions: z.array(permissionSchema),
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

export const supporterViewSchema = z.object({
  patient_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  permissions: z.array(permissionSchema),
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
});
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
