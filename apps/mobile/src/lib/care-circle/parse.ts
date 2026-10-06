import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Care Circle sections read (S29). Parsed by hand and never trusted: a row that does not match is dropped, and a reply
 * that is not what was expected means "nothing to show". The supporter view is the only thing a supporter can read about a
 * patient; a block that is absent is "not shared", never "zero".
 */
export const CIRCLE_PERMISSIONS = ["adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care"] as const;
export type CirclePermission = (typeof CIRCLE_PERMISSIONS)[number];
export const GRANT_DAY_CHOICES = [30, 90, 365] as const;

const PERMISSION_KEYS: Readonly<Record<CirclePermission, MessageKey>> = {
  adherence_summary: "circle.perm.adherence_summary",
  weekly_bp_trend: "circle.perm.weekly_bp_trend",
  appointments: "circle.perm.appointments",
  red_alerts: "circle.perm.red_alerts",
  pay_for_care: "circle.perm.pay_for_care",
};
export const permissionKey = (p: CirclePermission): MessageKey => PERMISSION_KEYS[p];

export interface CircleMember { memberId: string; name: string; relationship: string; permissions: CirclePermission[]; expiresAt: string }
export interface PendingInvite { inviteId: string; hint: string; relationship: string; expiresAt: string }
export interface MyCircle { members: CircleMember[]; invites: PendingInvite[] }
export interface SupportedPerson { patientId: string; memberId: string; name: string; relationship: string; permissions: CirclePermission[]; expiresAt: string }
export interface OpenAlert { patientId: string; name: string; since: string }
export interface ViewLogRow { viewer: string; at: string }
export interface SupporterView {
  patientId: string;
  name: string;
  sharedUntil: string;
  adherence?: { taken: number; due: number; percent: number | null };
  bpTrend?: { weeks: { weekStart: string; systolic: number; diastolic: number; readings: number }[]; direction: "higher" | "lower" | "steady" | null };
  appointments?: { nextAt: string | null; missed30d: number };
  canPay: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isPermission = (x: unknown): x is CirclePermission => CIRCLE_PERMISSIONS.some((p) => p === x);

/** Every entry must be a known circle permission; one unknown value drops the whole row (it is not something this build understands). */
function permissions(x: unknown): CirclePermission[] | null {
  if (!Array.isArray(x)) return null;
  return x.every(isPermission) ? (x as CirclePermission[]) : null;
}

export function parseMyCircle(data: unknown): MyCircle {
  const out: MyCircle = { members: [], invites: [] };
  if (!isObj(data)) return out;
  if (Array.isArray(data["members"])) {
    for (const m of data["members"]) {
      if (!isObj(m)) continue;
      const perms = permissions(m["permissions"]);
      if (str(m["member_id"]) && str(m["name"]) && str(m["relationship"]) && perms && str(m["expires_at"])) {
        out.members.push({ memberId: m["member_id"], name: m["name"], relationship: m["relationship"], permissions: perms, expiresAt: m["expires_at"] });
      }
    }
  }
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
      out.push({ patientId: r["patient_id"], memberId: r["member_id"], name: r["name"], relationship: r["relationship"], permissions: perms, expiresAt: r["expires_at"] });
    }
  }
  return out;
}

export function parseAlerts(data: unknown): OpenAlert[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["patient_id"]) && str(r["name"]) && str(r["since"]) ? [{ patientId: r["patient_id"], name: r["name"], since: r["since"] }] : []));
}

export function parseViewLog(data: unknown): ViewLogRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isObj(r) && str(r["viewer"]) && str(r["at"]) ? [{ viewer: r["viewer"], at: r["at"] }] : []));
}

/** Null means the access has ended or never existed. Only the blocks the database sent are kept, field by field, so a stray field cannot leak onto the screen. */
export function parseSupporterView(data: unknown): SupporterView | null {
  if (!isObj(data) || !str(data["patient_id"]) || !str(data["name"]) || !str(data["shared_until"])) return null;
  const v: SupporterView = { patientId: data["patient_id"], name: data["name"], sharedUntil: data["shared_until"], canPay: data["can_pay"] === true };
  const a = data["adherence"];
  if (isObj(a) && num(a["taken"]) && num(a["due"])) v.adherence = { taken: a["taken"], due: a["due"], percent: num(a["percent"]) ? a["percent"] : null };
  const b = data["bp_trend"];
  if (isObj(b) && Array.isArray(b["weeks"])) {
    const weeks = b["weeks"].flatMap((w) =>
      isObj(w) && str(w["week_start"]) && num(w["systolic"]) && num(w["diastolic"]) && num(w["readings"])
        ? [{ weekStart: w["week_start"], systolic: w["systolic"], diastolic: w["diastolic"], readings: w["readings"] }]
        : [],
    );
    const d = b["direction"];
    v.bpTrend = { weeks, direction: d === "higher" || d === "lower" || d === "steady" ? d : null };
  }
  const p = data["appointments"];
  if (isObj(p) && num(p["missed_30d"])) v.appointments = { nextAt: str(p["next_at"]) ? p["next_at"] : null, missed30d: p["missed_30d"] };
  return v;
}

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
