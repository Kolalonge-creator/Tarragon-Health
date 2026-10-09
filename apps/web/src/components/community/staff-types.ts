/**
 * Shared shapes for the Community staff screens. Importable from client components (no server code here).
 * A staff action always answers with plain English: `message` is safe to show, never raw database text.
 */
import type { ModRecentItem } from "@/lib/community/model";

export interface StaffActionResult {
  ok: boolean;
  message: string;
}

export const REMOVE_REASONS = [
  { code: "selling", label: "Selling or promoting" },
  { code: "medical_advice", label: "Medical advice or telling others to change a medicine" },
  { code: "harassment", label: "Harassment or abuse" },
  { code: "privacy", label: "Shares private details" },
  { code: "contact_details", label: "Contact details or moving the chat elsewhere" },
  { code: "other", label: "Another reason" },
] as const;
export type RemoveReasonCode = (typeof REMOVE_REASONS)[number]["code"];
export const REMOVE_REASON_CODES = REMOVE_REASONS.map((r) => r.code) as [RemoveReasonCode, ...RemoveReasonCode[]];

export const SANCTION_KINDS = [
  { code: "warning", label: "Warning", timed: false },
  { code: "mute", label: "Mute (cannot post for a while)", timed: true },
  { code: "suspend", label: "Suspend (cannot use the group for a while)", timed: true },
  { code: "ban", label: "Ban from this group", timed: false },
] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number]["code"];
export const SANCTION_KIND_CODES = SANCTION_KINDS.map((k) => k.code) as [SanctionKind, ...SanctionKind[]];

/** Plain reasons for taking down a live post from the "All recent posts" list. The database keeps the code as short text (2 to 40 characters). */
export const RECENT_REMOVE_REASONS = [
  { code: "off_topic", label: "Off topic" },
  { code: "unwanted", label: "Unwanted" },
  { code: "selling", label: "Selling" },
  { code: "contact_details", label: "Contact details" },
  { code: "unkind", label: "Unkind" },
  { code: "other", label: "Other" },
] as const;
export type RecentRemoveReasonCode = (typeof RECENT_REMOVE_REASONS)[number]["code"];
export const RECENT_REMOVE_REASON_CODES = RECENT_REMOVE_REASONS.map((r) => r.code) as [RecentRemoveReasonCode, ...RecentRemoveReasonCode[]];

export type ModDecision = "approve" | "remove" | "send_to_safety";
export type SafetyDecision = "release" | "keep_withheld" | "close";

export interface ModerationCallbacks {
  onDecide: (input: { postId: string; decision: ModDecision; reasonCode?: string }) => Promise<StaffActionResult>;
  onSanction: (input: { postId: string; kind: SanctionKind; reasonCode: string; hours?: number }) => Promise<StaffActionResult>;
}
/** One page of live posts, or a plain-English reason it could not be loaded. */
export type RecentPage = { ok: true; items: ModRecentItem[] } | { ok: false; message: string };
export interface RecentCallbacks {
  onLoadOlder: (input: { before: string; groupId?: string }) => Promise<RecentPage>;
  onRemove: (input: { postId: string; reasonCode: RecentRemoveReasonCode }) => Promise<StaffActionResult>;
}
export interface SafetyCallbacks {
  onDecide: (input: { signalId: string; decision: SafetyDecision }) => Promise<StaffActionResult>;
}

export type AppealDecision = "uphold" | "overturn";
export interface AppealCallbacks {
  onDecide: (input: { appealId: string; decision: AppealDecision; note?: string }) => Promise<StaffActionResult>;
}
export interface SampleCallbacks {
  onReview: (input: { sampleId: string; agrees: boolean; note?: string }) => Promise<StaffActionResult>;
}
export interface DisplayNameCallbacks {
  onSave: (input: { name: string }) => Promise<StaffActionResult>;
}

/** The display name rule, mirrored from the database: starts with a letter; letters, spaces, comma, full stop, hyphen, apostrophe; 2 to 40. */
export const DISPLAY_NAME_PATTERN = /^[A-Za-z][A-Za-z ,.'-]{1,39}$/;
export const NOTE_MAX = 500;
