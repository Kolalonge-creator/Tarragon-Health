import type { MessageKey } from "@tarragon/i18n";
import {
  array,
  boolean,
  int,
  isRecord,
  literal,
  nonNegativeInt,
  nullable,
  object,
  oneOf,
  optional,
  parse,
  positiveInt,
  string,
  withDefault,
  type Parser,
} from "./parse";

/**
 * What the Community screens read from the database (docs/COMMUNITY_SPEC.md), as the phone sees it.
 *
 * SOURCE OF TRUTH: apps/web/src/lib/community/model.ts (the zod schemas, composeOutcome and the key tables). This file is a small
 * mobile-local copy of only what the patient screens need, with the same field names. apps/mobile cannot import from apps/web and does
 * not depend on zod, so the shapes are read with ./parse.ts. If the web file changes a shape, change it here too; model.test.ts pins the
 * message mapping against the real English catalogue so a renamed key fails a test rather than showing a blank.
 *
 * Two rules these types encode (same as web):
 *   1. A member is only ever a HANDLE. There is no field here that could hold a profile id, a name, a phone number or an email for
 *      another member. The one name ever shown is a clinician who reviewed a pinned note or answered a doctor question.
 *   2. Every limit (post length, edit window, questions per session) comes from the database reply, never from a constant in the app.
 */

// ---------------------------------------------------------------------------
// Group list and group view
// ---------------------------------------------------------------------------
export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  topic_code: string;
  topic_label: string;
  status: "active" | "read_only";
  member_count: number;
  my_status: "none" | "pending" | "active" | "left" | "suspended" | "banned";
  /** The group has reached its size cap. Absent from an older database. */
  full?: boolean;
}
const groupSummaryParser: Parser<GroupSummary> = object({
  id: string,
  slug: string,
  name: string,
  description: string,
  topic_code: string,
  topic_label: string,
  status: oneOf(["active", "read_only"] as const),
  member_count: nonNegativeInt,
  my_status: oneOf(["none", "pending", "active", "left", "suspended", "banned"] as const),
  full: optional(boolean),
});

export interface GroupList {
  open: boolean;
  adult: boolean;
  groups: GroupSummary[];
}
const groupListParser: Parser<GroupList> = object({ open: boolean, adult: boolean, groups: array(groupSummaryParser) });
export const parseGroupList = (data: unknown): GroupList | undefined => parse(groupListParser, data);

export interface PinnedNote {
  id: string;
  title: string;
  body: string;
  /** Null-gated attribution: shown only when BOTH are present. */
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}
const pinnedNoteParser: Parser<PinnedNote> = object({
  id: string,
  title: string,
  body: string,
  reviewed_at: nullable(string),
  reviewed_by_name: nullable(string),
});

export type Membership =
  | { status: "none" }
  | {
      status: "pending" | "active" | "left" | "suspended" | "banned";
      handle: string;
      avatar_code: string;
      rules_current: boolean;
      notifications_muted: boolean;
      digest_opt_in?: boolean;
    };
const memberRowParser = object({
  status: oneOf(["pending", "active", "left", "suspended", "banned"] as const),
  handle: string,
  avatar_code: string,
  rules_current: boolean,
  notifications_muted: boolean,
  digest_opt_in: optional(boolean),
});
const membershipParser: Parser<Membership> = (u) => {
  if (!isRecord(u)) return { ok: false };
  if (u["status"] === "none") return { ok: true, value: { status: "none" } };
  return memberRowParser(u);
};

export interface TeamMember {
  display_name: string;
  scope: "moderator" | "safety_reviewer";
}
const teamParser: Parser<TeamMember> = object({ display_name: string, scope: oneOf(["moderator", "safety_reviewer"] as const) });

export interface GroupPrompt {
  id: string;
  body: string;
}
const promptParser: Parser<GroupPrompt> = object({ id: string, body: string });

export interface QaSession {
  session_id: string;
  title: string;
  intro: string;
  opens_at: string;
  closes_at: string;
  status: "upcoming" | "open" | "closed";
  doctors: string[];
  my_questions: number;
  question_limit: number;
}
const qaParser: Parser<QaSession> = object({
  session_id: string,
  title: string,
  intro: string,
  opens_at: string,
  closes_at: string,
  status: oneOf(["upcoming", "open", "closed"] as const),
  doctors: array(string),
  my_questions: int,
  question_limit: int,
});

export interface GroupDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  topic_code: string;
  topic_label: string | null;
  status: "active" | "read_only";
  rules_text: string;
  rules_version: number;
  join_mode: "open" | "request" | "invite";
  full?: boolean;
  /** One picture per post is allowed in this group (every picture is checked by a moderator first). */
  images_allowed?: boolean;
}
const groupDetailParser: Parser<GroupDetail> = object({
  id: string,
  slug: string,
  name: string,
  description: string,
  topic_code: string,
  topic_label: nullable(string),
  status: oneOf(["active", "read_only"] as const),
  rules_text: string,
  rules_version: int,
  join_mode: oneOf(["open", "request", "invite"] as const),
  full: optional(boolean),
  images_allowed: optional(boolean),
});

export interface GroupLimits {
  post_max_chars: number;
  edit_window_minutes: number;
}
const limitsParser: Parser<GroupLimits> = object({ post_max_chars: positiveInt, edit_window_minutes: nonNegativeInt });

export type GroupView =
  | { found: false; reason: string }
  | {
      found: true;
      group: GroupDetail;
      membership: Membership;
      pinned: PinnedNote[];
      team: TeamMember[];
      prompts: GroupPrompt[];
      qa: QaSession | null;
      limits: GroupLimits;
    };
const foundViewParser = object({
  found: literal(true),
  group: groupDetailParser,
  membership: membershipParser,
  pinned: array(pinnedNoteParser),
  team: withDefault(array(teamParser), []),
  prompts: withDefault(array(promptParser), []),
  qa: withDefault(nullable(qaParser), null),
  limits: limitsParser,
});
const groupViewParser: Parser<GroupView> = (u) => {
  if (!isRecord(u)) return { ok: false };
  if (u["found"] === false) return object({ found: literal(false), reason: string })(u);
  return foundViewParser(u);
};
export const parseGroupView = (data: unknown): GroupView | undefined => parse(groupViewParser, data);

// ---------------------------------------------------------------------------
// Feed and replies
// ---------------------------------------------------------------------------
export interface FeedAnswer {
  id: string;
  doctor_name: string;
  body: string;
  created_at: string;
}
const answerParser: Parser<FeedAnswer> = object({ id: string, doctor_name: string, body: string, created_at: string });

export interface FeedPost {
  id: string;
  author_handle: string;
  author_avatar: string | null;
  is_mine: boolean;
  body: string;
  created_at: string;
  edited_at: string | null;
  support_count: number;
  reply_count?: number;
  i_supported: boolean;
  pending_review: boolean;
  /** One picture per post. Loaded through /api/community/images/{id}; never a URL. */
  image?: { id: string; width: number; height: number } | null;
  qa_session_id?: string | null;
  answers: FeedAnswer[];
}
const feedPostParser: Parser<FeedPost> = object({
  id: string,
  author_handle: string,
  author_avatar: nullable(string),
  is_mine: boolean,
  body: string,
  created_at: string,
  edited_at: nullable(string),
  support_count: nonNegativeInt,
  reply_count: optional(nonNegativeInt),
  i_supported: boolean,
  pending_review: boolean,
  image: optional(nullable(object({ id: string, width: int, height: int }))),
  qa_session_id: optional(nullable(string)),
  answers: withDefault(array(answerParser), []),
});

export type Feed = { ok: false; reason: string } | { ok: true; posts: FeedPost[]; has_more: boolean };
const feedParser: Parser<Feed> = (u) => {
  if (!isRecord(u)) return { ok: false };
  if (u["ok"] === false) return object({ ok: literal(false), reason: string })(u);
  return object({ ok: literal(true), posts: array(feedPostParser), has_more: boolean })(u);
};
export const parseFeed = (data: unknown): Feed | undefined => parse(feedParser, data);

export type Replies = { ok: false; reason: string } | { ok: true; replies: FeedPost[] };
const repliesParser: Parser<Replies> = (u) => {
  if (!isRecord(u)) return { ok: false };
  if (u["ok"] === false) return object({ ok: literal(false), reason: string })(u);
  return object({ ok: literal(true), replies: array(feedPostParser) })(u);
};
export const parseReplies = (data: unknown): Replies | undefined => parse(repliesParser, data);

// ---------------------------------------------------------------------------
// Replies to actions
// ---------------------------------------------------------------------------
/** Join, leave, mute, react, report, edit, delete and the other actions all answer {status, reason?} (plus a few extras). */
export interface Outcome {
  status: string;
  reason?: string;
  handle?: string;
  avatar_code?: string;
  rules_version?: number;
  support_count?: number;
  i_supported?: boolean;
  notifications_muted?: boolean;
  digest_opt_in?: boolean;
}
const outcomeParser: Parser<Outcome> = object({
  status: string,
  reason: optional(string),
  handle: optional(string),
  avatar_code: optional(string),
  rules_version: optional(int),
  support_count: optional(int),
  i_supported: optional(boolean),
  notifications_muted: optional(boolean),
  digest_opt_in: optional(boolean),
});
export const parseOutcome = (data: unknown): Outcome | undefined => parse(outcomeParser, data);

export interface SubmitResult {
  status: "published" | "held" | "blocked" | "withheld" | "refused";
  reason?: string;
  safety_kind?: "emergency" | "self_harm";
  post_id?: string;
  repeat?: boolean;
  rules_version?: number;
}
const submitResultParser: Parser<SubmitResult> = object({
  status: oneOf(["published", "held", "blocked", "withheld", "refused"] as const),
  reason: optional(string),
  safety_kind: optional(oneOf(["emergency", "self_harm"] as const)),
  post_id: optional(string),
  repeat: optional(boolean),
  rules_version: optional(int),
});
export const parseSubmitResult = (data: unknown): SubmitResult | undefined => parse(submitResultParser, data);

export interface HiddenAuthor {
  id: string;
  handle: string;
}
export type HiddenList = { ok: false; reason: string } | { ok: true; hidden: HiddenAuthor[] };
const hiddenListParser: Parser<HiddenList> = (u) => {
  if (!isRecord(u)) return { ok: false };
  if (u["ok"] === false) return object({ ok: literal(false), reason: string })(u);
  return object({ ok: literal(true), hidden: array(object({ id: string, handle: string })) })(u);
};
export const parseHiddenList = (data: unknown): HiddenList | undefined => parse(hiddenListParser, data);

export const APPEAL_STATUSES = ["open", "upheld", "overturned"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];
export interface RemovedPost {
  post_id: string;
  group_name: string;
  removed_at: string | null;
  reason_code: string | null;
  appeal_status: AppealStatus | null;
  can_appeal: boolean;
}
export interface Sanction {
  sanction_id: string;
  kind: "warning" | "mute" | "suspend" | "ban";
  group_name: string | null;
  starts_at: string;
  ends_at: string | null;
  reason_code: string;
  overturned: boolean;
  appeal_status: AppealStatus | null;
  can_appeal: boolean;
}
export interface MyActions {
  open: boolean;
  removed_posts: RemovedPost[];
  sanctions: Sanction[];
}
const myActionsParser: Parser<MyActions> = object({
  open: boolean,
  removed_posts: array(
    object({
      post_id: string,
      group_name: string,
      removed_at: nullable(string),
      reason_code: nullable(string),
      appeal_status: nullable(oneOf(APPEAL_STATUSES)),
      can_appeal: boolean,
    }),
  ),
  sanctions: array(
    object({
      sanction_id: string,
      kind: oneOf(["warning", "mute", "suspend", "ban"] as const),
      group_name: nullable(string),
      starts_at: string,
      ends_at: nullable(string),
      reason_code: string,
      overturned: boolean,
      appeal_status: nullable(oneOf(APPEAL_STATUSES)),
      can_appeal: boolean,
    }),
  ),
});
export const parseMyActions = (data: unknown): MyActions | undefined => parse(myActionsParser, data);

// ---------------------------------------------------------------------------
// Report reasons
// ---------------------------------------------------------------------------
export const REPORT_REASONS = [
  "contact_details",
  "selling_or_promotion",
  "medical_misinformation",
  "harassment",
  "self_harm_or_danger",
  "privacy",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const REPORT_REASON_KEYS: Readonly<Record<ReportReason, MessageKey>> = {
  contact_details: "community.report.reason.contact_details",
  selling_or_promotion: "community.report.reason.selling_or_promotion",
  medical_misinformation: "community.report.reason.medical_misinformation",
  harassment: "community.report.reason.harassment",
  self_harm_or_danger: "community.report.reason.self_harm_or_danger",
  privacy: "community.report.reason.privacy",
  other: "community.report.reason.other",
};
export const reportReasonKey = (r: ReportReason): MessageKey => REPORT_REASON_KEYS[r];

// ---------------------------------------------------------------------------
// Messages. The mapping is total: an unknown reason from a newer database falls back to a calm generic line, never to raw text or a
// blank. The text itself lives in packages/i18n (community.*). Same tables as the web model.
// ---------------------------------------------------------------------------
export const REFUSED_KEYS = {
  rate_limited: "community.compose.refused.rate_limited",
  cooling_down: "community.compose.refused.cooling_down",
  muted: "community.compose.refused.muted",
  suspended: "community.compose.refused.suspended",
  banned: "community.compose.refused.banned",
  empty: "community.compose.refused.empty",
  too_long: "community.compose.refused.too_long",
  not_a_member: "community.compose.refused.not_a_member",
  accept_rules: "community.compose.refused.accept_rules",
  group_closed: "community.compose.refused.group_closed",
  group_read_only: "community.compose.refused.group_read_only",
  reply_target_gone: "community.compose.refused.reply_target_gone",
  not_ready: "community.compose.refused.not_ready",
  not_open_yet: "community.compose.refused.not_open_yet",
  adults_only: "community.compose.refused.adults_only",
  edit_window_over: "community.compose.refused.edit_window_over",
  not_yours: "community.compose.refused.not_yours",
  not_editable: "community.compose.refused.not_editable",
  images_off: "community.compose.refused.images_off",
  bad_image: "community.compose.refused.bad_image",
  qa_closed: "community.compose.refused.qa_closed",
  qa_limit: "community.compose.refused.qa_limit",
} as const satisfies Record<string, MessageKey>;

export const HELD_KEYS = {
  new_member: "community.compose.held.new_member",
  commerce: "community.compose.held.commerce",
  cure_claim: "community.compose.held.cure_claim",
  medicine_instruction: "community.compose.held.medicine_instruction",
  contact_platform: "community.compose.held.contact_platform",
  abuse: "community.compose.held.abuse",
  spam: "community.compose.held.spam",
  eating_disorder: "community.compose.held.eating_disorder",
  image: "community.compose.held.image",
} as const satisfies Record<string, MessageKey>;

export const JOIN_REFUSED_KEYS = {
  consent_needed: "community.join.refused.consent_needed",
  rules_changed: "community.join.refused.rules_changed",
  by_invitation: "community.join.refused.by_invitation",
  group_closed: "community.join.refused.group_closed",
  not_allowed: "community.join.refused.not_allowed",
  not_open_yet: "community.join.refused.not_open_yet",
  adults_only: "community.join.refused.adults_only",
  group_full: "community.join.refused.group_full",
} as const satisfies Record<string, MessageKey>;

export const APPEAL_REFUSED_KEYS = {
  reason_length: "community.appeals.refused.reason_length",
  already_appealed: "community.appeals.refused.already_appealed",
  not_appealable: "community.appeals.refused.not_appealable",
  not_open_yet: "community.appeals.refused.not_appealable",
  safety: "community.appeals.refused.safety",
  contact_details: "community.appeals.refused.contact_details",
} as const satisfies Record<string, MessageKey>;

function lookup<T extends Record<string, MessageKey>>(table: T, key: string | undefined, fallback: MessageKey): MessageKey {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key as keyof T] : fallback;
}

export const FAILED_KEY: MessageKey = "community.compose.refused.other";

export type ComposeOutcome =
  | { kind: "published"; message: MessageKey }
  | { kind: "held"; message: MessageKey }
  | { kind: "blocked"; message: MessageKey }
  | { kind: "refused"; message: MessageKey }
  /** Emergency or self-harm language: nothing is posted, and the screen must show the matching safety card before anything else. */
  | { kind: "safety"; safety: "emergency" | "self_harm"; message: MessageKey };

/** Turns the reply to a post, an edit or a question into what the screen should do. Total: never throws, never shows raw database text. */
export function composeOutcome(result: SubmitResult): ComposeOutcome {
  switch (result.status) {
    case "published":
      return { kind: "published", message: "community.compose.published" };
    case "held":
      return { kind: "held", message: lookup(HELD_KEYS, result.reason, "community.compose.held") };
    case "blocked":
      return {
        kind: "blocked",
        message: result.reason === "contact" ? "community.compose.blocked.contact" : "community.compose.blocked.other",
      };
    case "withheld":
      return result.safety_kind === "self_harm"
        ? { kind: "safety", safety: "self_harm", message: "community.safety.self_harm.title" }
        : { kind: "safety", safety: "emergency", message: "community.safety.emergency.title" };
    default:
      return { kind: "refused", message: lookup(REFUSED_KEYS, result.reason, "community.compose.refused.other") };
  }
}

/** The message for a refused action (anything that answers {status, reason}). */
export function refusalKey(reason: string | undefined): MessageKey {
  return lookup(REFUSED_KEYS, reason, FAILED_KEY);
}

/** The message for a refused or failed join. */
export function joinRefusalKey(reason: string | undefined): MessageKey {
  return lookup(JOIN_REFUSED_KEYS, reason, FAILED_KEY);
}

/** The message for a refused appeal. Total, like the others. */
export function appealRefusalKey(reason: string | undefined): MessageKey {
  return lookup(APPEAL_REFUSED_KEYS, reason, "community.appeals.refused.other");
}

export const replyCountKey = (count: number): MessageKey => (count === 1 ? "community.post.reply_one" : "community.post.replies");
export const memberCountKey = (count: number): MessageKey => (count === 1 ? "community.groups.member_one" : "community.groups.members");

export const TEAM_ROLE_KEY: Readonly<Record<TeamMember["scope"], MessageKey>> = {
  moderator: "community.team.moderator",
  safety_reviewer: "community.team.safety_reviewer",
};

export const SANCTION_KEY: Readonly<Record<Sanction["kind"], MessageKey>> = {
  warning: "community.appeals.sanction_warning",
  mute: "community.appeals.sanction_mute",
  suspend: "community.appeals.sanction_suspend",
  ban: "community.appeals.sanction_ban",
};

export const APPEAL_STATUS_KEY: Readonly<Record<AppealStatus, MessageKey>> = {
  open: "community.appeals.status.open",
  upheld: "community.appeals.status.upheld",
  overturned: "community.appeals.status.overturned",
};

/** An appeal needs at least this many characters (the database enforces it too, and says so in appeals.refused.reason_length). */
export const APPEAL_MIN_CHARS = 10;
export const APPEAL_MAX_CHARS = 1000;

/** Search outside this range asks for the plain list instead (the database and the web action do the same). */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 60;
export function isSearchQuery(q: string): boolean {
  const n = q.trim().length;
  return n >= SEARCH_MIN_CHARS && n <= SEARCH_MAX_CHARS;
}

/** Whether a post can still be edited by its author: inside the window the GROUP reports (never a constant here). */
export function withinEditWindow(createdAtIso: string, editWindowMinutes: number, nowMs: number): boolean {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return false;
  return nowMs - created <= editWindowMinutes * 60_000;
}
