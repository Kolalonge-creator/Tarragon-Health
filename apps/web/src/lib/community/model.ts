import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Community screens read from the database (docs/COMMUNITY_SPEC.md). Every reply is PARSED, never trusted: a shape that does
 * not match is treated as "nothing to show" rather than rendered half-wrong.
 *
 * Two rules these types encode:
 *   1. A member is only ever a HANDLE. There is deliberately no field anywhere in this file that could hold a profile id, a name, a
 *      phone number or an email for another member. The one name that is ever shown is a clinician who reviewed a pinned note.
 *   2. Every limit (post length, edit window) comes from the database reply, never from a constant in the app: they are PROPOSED values
 *      in versioned configuration.
 */

// ---------------------------------------------------------------------------
// Patient side
// ---------------------------------------------------------------------------
export const groupSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  topic_code: z.string(),
  topic_label: z.string(),
  status: z.enum(["active", "read_only"]),
  member_count: z.number().int().nonnegative(),
  my_status: z.enum(["none", "pending", "active", "left", "suspended", "banned"]),
  /** The group has reached its size cap (Phase 2). Absent from an older database. */
  full: z.boolean().optional(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupListSchema = z.object({
  open: z.boolean(),
  adult: z.boolean(),
  groups: z.array(groupSummarySchema),
});
export type GroupList = z.infer<typeof groupListSchema>;

export const pinnedNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  // Null-gated attribution: the note is only returned once a second clinician reviewed it, so both are always present here. They are
  // still nullable in the type so a component can never render "Reviewed by" from a hard-coded string.
  reviewed_at: z.string().nullable(),
  reviewed_by_name: z.string().nullable(),
});
export type PinnedNote = z.infer<typeof pinnedNoteSchema>;

export const membershipSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({
    status: z.enum(["pending", "active", "left", "suspended", "banned"]),
    handle: z.string(),
    avatar_code: z.string(),
    rules_current: z.boolean(),
    notifications_muted: z.boolean(),
    digest_opt_in: z.boolean().optional(),
  }),
]);
export type Membership = z.infer<typeof membershipSchema>;

export const groupViewSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false), reason: z.string() }),
  z.object({
    found: z.literal(true),
    group: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string(),
      topic_code: z.string(),
      topic_label: z.string().nullable(),
      status: z.enum(["active", "read_only"]),
      rules_text: z.string(),
      rules_version: z.number().int(),
      join_mode: z.enum(["open", "request", "invite"]),
      full: z.boolean().optional(),
      images_allowed: z.boolean().optional(),
    }),
    membership: membershipSchema,
    pinned: z.array(pinnedNoteSchema),
    /** Staff who chose to show a name. A role label and a name they typed; never an account id. */
    team: z.array(z.object({ display_name: z.string(), scope: z.enum(["moderator", "safety_reviewer"]) })).default([]),
    /** Short lines the team shows at the top of the group for a while. */
    prompts: z.array(z.object({ id: z.string(), body: z.string() })).default([]),
    /** The doctor question session to show: open now, starting within a week, or ended within a week. */
    qa: z
      .object({
        session_id: z.string(),
        title: z.string(),
        intro: z.string(),
        opens_at: z.string(),
        closes_at: z.string(),
        status: z.enum(["upcoming", "open", "closed"]),
        doctors: z.array(z.string()),
        my_questions: z.number().int(),
        question_limit: z.number().int(),
      })
      .nullable()
      .default(null),
    limits: z.object({ post_max_chars: z.number().int().positive(), edit_window_minutes: z.number().int().nonnegative() }),
  }),
]);
export type GroupView = z.infer<typeof groupViewSchema>;

/** A post or a reply as the feed returns it. `author_handle` is the made-up name; there is no other identity field. */
export const feedPostSchema = z.object({
  id: z.string(),
  author_handle: z.string(),
  author_avatar: z.string().nullable(),
  is_mine: z.boolean(),
  body: z.string(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  support_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative().optional(),
  i_supported: z.boolean(),
  pending_review: z.boolean(),
  /** One picture per post. Loaded through /api/community/images/{id}; never a URL. */
  image: z.object({ id: z.string(), width: z.number().int(), height: z.number().int() }).nullable().optional(),
  qa_session_id: z.string().nullable().optional(),
  /** Answers from the named doctors of a question session, with the doctor's real name. */
  answers: z.array(z.object({ id: z.string(), doctor_name: z.string(), body: z.string(), created_at: z.string() })).default([]),
});
export type FeedPost = z.infer<typeof feedPostSchema>;

export const feedSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), reason: z.string() }),
  z.object({ ok: z.literal(true), posts: z.array(feedPostSchema), has_more: z.boolean() }),
]);
export type Feed = z.infer<typeof feedSchema>;

export const repliesSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), reason: z.string() }),
  z.object({ ok: z.literal(true), replies: z.array(feedPostSchema) }),
]);
export type Replies = z.infer<typeof repliesSchema>;

/** Join, leave, mute, react, report, edit, delete and the staff actions all answer {status, reason?} (plus a few extras). */
export const outcomeSchema = z
  .object({
    status: z.string(),
    reason: z.string().optional(),
    handle: z.string().optional(),
    avatar_code: z.string().optional(),
    rules_version: z.number().int().optional(),
    support_count: z.number().int().optional(),
    i_supported: z.boolean().optional(),
    notifications_muted: z.boolean().optional(),
  })
  .passthrough();
export type Outcome = z.infer<typeof outcomeSchema>;

export const submitResultSchema = z
  .object({
    status: z.enum(["published", "held", "blocked", "withheld", "refused"]),
    reason: z.string().optional(),
    safety_kind: z.enum(["emergency", "self_harm"]).optional(),
    post_id: z.string().optional(),
    repeat: z.boolean().optional(),
    rules_version: z.number().int().optional(),
  })
  .passthrough();
export type SubmitResult = z.infer<typeof submitResultSchema>;

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
export const reportReasonSchema = z.enum(REPORT_REASONS);

// ---------------------------------------------------------------------------
// Messages. The mapping is total: an unknown reason from a newer database falls back to a calm generic line, never to raw text or a
// blank. The text itself lives in packages/i18n (community.*).
// ---------------------------------------------------------------------------
const REFUSED_KEYS = {
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

const HELD_KEYS = {
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

const JOIN_REFUSED_KEYS = {
  consent_needed: "community.join.refused.consent_needed",
  rules_changed: "community.join.refused.rules_changed",
  by_invitation: "community.join.refused.by_invitation",
  group_closed: "community.join.refused.group_closed",
  not_allowed: "community.join.refused.not_allowed",
  not_open_yet: "community.join.refused.not_open_yet",
  adults_only: "community.join.refused.adults_only",
  group_full: "community.join.refused.group_full",
} as const satisfies Record<string, MessageKey>;

function lookup<T extends Record<string, MessageKey>>(table: T, key: string | undefined, fallback: MessageKey): MessageKey {
  return key !== undefined && Object.hasOwn(table, key) ? table[key as keyof T] : fallback;
}

export type ComposeOutcome =
  | { kind: "published"; message: MessageKey }
  | { kind: "held"; message: MessageKey }
  | { kind: "blocked"; message: MessageKey }
  | { kind: "refused"; message: MessageKey }
  /** Emergency or self-harm language: nothing is posted, and the screen must show the matching safety card before anything else. */
  | { kind: "safety"; safety: "emergency" | "self_harm"; message: MessageKey };

/** Turns the reply to a post or an edit into what the screen should do. Total: never throws, never shows raw database text. */
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

/** The message for a refused or failed join. */
export function joinRefusalKey(reason: string | undefined): MessageKey {
  return lookup(JOIN_REFUSED_KEYS, reason, "community.compose.refused.other");
}

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

/** Reply count wording: one is singular. */
export function replyCountKey(count: number): MessageKey {
  return count === 1 ? "community.post.reply_one" : "community.post.replies";
}
export function memberCountKey(count: number): MessageKey {
  return count === 1 ? "community.groups.member_one" : "community.groups.members";
}

// ---------------------------------------------------------------------------
// Staff side (moderation, safety review, administration). Plain English on the staff screens, as elsewhere (OQ-183).
// No schema here has a field for a member's identity either: a moderator or a safety reviewer works from a handle and the text.
// ---------------------------------------------------------------------------
export const HOLD_REASON_LABEL: Readonly<Record<string, string>> = {
  new_member: "New member: first posts are checked",
  commerce: "May be selling or promoting",
  cure_claim: "Claims about a treatment or product",
  medicine_instruction: "Telling others to change a medicine",
  contact_platform: "Mentions another app",
  abuse: "Possible threat or abuse",
  spam: "Possible spam",
  reported: "Hidden after reports",
};
export const holdReasonLabel = (code: string): string => HOLD_REASON_LABEL[code] ?? code;

export const modItemSchema = z.object({
  post_id: z.string(),
  group_id: z.string(),
  group_name: z.string(),
  author_handle: z.string(),
  is_reply: z.boolean(),
  body: z.string(),
  state: z.enum(["held", "auto_hidden", "visible"]),
  reasons: z.array(z.string()),
  created_at: z.string(),
  report_count: z.number().int().nonnegative(),
  report_reasons: z.array(z.string()),
  author_is_new: z.boolean(),
  /** A picture waiting to be checked. Opened through /api/community/images/{id}. */
  image_id: z.string().nullable().optional(),
  qa_session_id: z.string().nullable().optional(),
});
export type ModItem = z.infer<typeof modItemSchema>;
export const modQueueSchema = z.object({ items: z.array(modItemSchema) });

export const safetyItemSchema = z.object({
  signal_id: z.string(),
  kind: z.enum(["emergency_language", "self_harm_language", "reviewer_concern"]),
  status: z.enum(["open", "in_review"]),
  created_at: z.string(),
  group_name: z.string(),
  post_id: z.string(),
  post_state: z.string(),
  author_handle: z.string(),
  body: z.string(),
  image_id: z.string().nullable().optional(),
});
export type SafetyItem = z.infer<typeof safetyItemSchema>;
export const safetyQueueSchema = z.object({ items: z.array(safetyItemSchema) });

export const staffContextSchema = z.object({
  is_admin: z.boolean(),
  is_cmo: z.boolean(),
  is_moderator: z.boolean(),
  is_safety_reviewer: z.boolean(),
  is_clinician: z.boolean(),
});
export type StaffContext = z.infer<typeof staffContextSchema>;

export const adminGroupSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  topic_code: z.string(),
  topic_label: z.string(),
  requires_cmo_rules: z.boolean(),
  rules_text: z.string(),
  rules_version: z.number().int(),
  rules_approved: z.boolean(),
  rules_approved_at: z.string().nullable(),
  join_mode: z.enum(["open", "request", "invite"]),
  member_cap: z.number().int().nullable().optional(),
  status: z.enum(["draft", "active", "read_only", "archived"]),
  created_at: z.string(),
  member_count: z.number().int(),
  held_posts: z.number().int(),
  open_reports: z.number().int(),
  open_signals: z.number().int(),
});
export type AdminGroup = z.infer<typeof adminGroupSchema>;
export const adminGroupsSchema = z.object({ groups: z.array(adminGroupSchema) });

export const adminTopicSchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
  requires_cmo_rules: z.boolean(),
});
export type AdminTopic = z.infer<typeof adminTopicSchema>;
export const adminTopicsSchema = z.object({ topics: z.array(adminTopicSchema) });

export const staffGrantSchema = z.object({
  id: z.string(),
  scope: z.enum(["moderator", "safety_reviewer"]),
  group_id: z.string().nullable(),
  group_name: z.string().nullable(),
  profile_role: z.string(),
  staff_name: z.string().nullable(),
  granted_at: z.string(),
  revoked_at: z.string().nullable(),
});
export type StaffGrant = z.infer<typeof staffGrantSchema>;
export const adminStaffSchema = z.object({ staff: z.array(staffGrantSchema) });

export const ruleSetSchema = z.object({
  version: z.number().int(),
  status: z.enum(["draft", "active", "retired"]),
  params: z.object({ allowed_hosts: z.array(z.string()).optional() }).passthrough(),
  notes: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_by_name: z.string().nullable().optional(),
  rule_count: z.number().int(),
  safety_rule_count: z.number().int(),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;
export const ruleSetsSchema = z.object({ rule_sets: z.array(ruleSetSchema) });

export const ruleSchema = z.object({
  id: z.number().int(),
  class: z.string(),
  kind: z.enum(["detector", "regex"]),
  pattern: z.string(),
  action: z.enum(["block", "hold", "safety"]),
  note: z.string().nullable(),
});
export type Rule = z.infer<typeof ruleSchema>;
export const rulesSchema = z.object({ rules: z.array(ruleSchema) });

export const pinnedAdminSchema = z.object({
  pinned: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      pinned_at: z.string(),
      unpinned_at: z.string().nullable(),
      authored_by_name: z.string().nullable(),
      reviewed_by_name: z.string().nullable(),
      reviewed_at: z.string().nullable(),
      authored_by_me: z.boolean().optional(),
    }),
  ),
});

export const noteGroupsSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      status: z.string(),
      topic_label: z.string(),
    }),
  ),
});

export const overviewSchema = z.object({
  groups_active: z.number().int(),
  groups_draft: z.number().int(),
  members_active: z.number().int(),
  posts_awaiting_review: z.number().int(),
  open_reports: z.number().int(),
  open_safety_signals: z.number().int(),
  moderators: z.number().int(),
  safety_reviewers: z.number().int(),
  active_rule_set: z.number().int().nullable(),
});
export type Overview = z.infer<typeof overviewSchema>;

/** The message for a refused staff action, in plain English. Anything unknown is a calm generic line. */
const STAFF_REFUSED: Readonly<Record<string, string>> = {
  reason_needed: "Please give a reason.",
  hours_needed: "Please say how many hours (1 to 8760).",
  bad_decision: "That choice is not available.",
  still_blocked: "This post also contains contact details, so it cannot be published. Keep it withheld or close it.",
  bad_kind: "That sanction is not available.",
  already_handled: "Someone else has already handled this.",
  already_closed: "This post is already closed.",
  not_your_appeal_to_decide: "You made the original decision, so another moderator needs to decide this appeal.",
  already_decided: "This appeal has already been decided.",
  not_found: "That could not be found. It may have been removed already.",
  not_ready: "The text filters are not ready, so this cannot be saved yet. Ask the Chief Medical Officer to check the live rule set.",
  your_own_decision: "You made this decision, so another moderator needs to check it.",
  already_reviewed: "This has already been checked.",
  choose_one: "Please choose whether you agree.",
  note_too_long: "Please keep the note under 500 characters.",
  bad_name: "Use letters, spaces, commas, full stops, hyphens and apostrophes only, 2 to 40 characters. No numbers.",
  bad_cap: "A group size cap is a whole number from 10 to 100000, or empty for no cap.",
  text_not_allowed: "That text has a phone number, email, link or other wording the community filters refuse. Please rewrite it.",
  bad_length: "Please write between 5 and 300 characters.",
  bad_window: "The end time must be after the start time. A question session can run for up to 12 hours.",
  bad_shifts: "Each shift needs a day (Monday to Sunday) and whole hours, with the end after the start. For an overnight shift add two rows.",
  bad_text: "Please give the session a title of 3 to 80 characters and an introduction of up to 300.",
  bad_people: "Pick at least one doctor and at least one group.",
  not_a_doctor: "Only active doctors can be named on a question session.",
  qa_closed: "This session is not open for answers right now.",
  not_for_this_topic: "Pictures cannot be turned on for a weight-loss group.",
  no_such_post: "That post is no longer there.",
  no_such_member: "No member matches that name in this group.",
  no_such_group: "That group no longer exists.",
  no_such_signal: "That signal no longer exists.",
  no_such_rule: "That rule no longer exists.",
  not_a_draft: "Only a draft can be changed.",
  not_a_list: "Please give a list of hostnames.",
  bad_hostname: "A hostname looks like example.com, with no path and no wildcard.",
  safety_reviewer_only: "Only a safety reviewer can handle this one.",
  rules_changed: "The rules changed while you were looking. Please reload and check them.",
  reason_too_short: "The reason is too short. Say why you need to know who this is.",
  daily_limit: "You have reached today's limit for this.",
  not_active: "That grant is not active.",
  not_reviewable: "You cannot review this note. A different clinician has to.",
  not_pinned: "That note is not pinned.",
};
export const staffRefusalText = (reason: string | undefined): string =>
  (reason !== undefined && Object.hasOwn(STAFF_REFUSED, reason) ? STAFF_REFUSED[reason] : undefined) ?? "That could not be done. Please try again.";

// ---------------------------------------------------------------------------
// Phase 2: hiding one person, appeals (patient side)
// ---------------------------------------------------------------------------
/** People the member has hidden in one group. A handle and the row id needed to show them again; nothing else. */
export const hiddenListSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), reason: z.string() }),
  z.object({ ok: z.literal(true), hidden: z.array(z.object({ id: z.string(), handle: z.string() })) }),
]);
export type HiddenList = z.infer<typeof hiddenListSchema>;

export const APPEAL_STATUSES = ["open", "upheld", "overturned"] as const;
export const myActionsSchema = z.object({
  open: z.boolean(),
  removed_posts: z.array(
    z.object({
      post_id: z.string(),
      group_name: z.string(),
      removed_at: z.string().nullable(),
      reason_code: z.string().nullable(),
      appeal_status: z.enum(APPEAL_STATUSES).nullable(),
      can_appeal: z.boolean(),
    }),
  ),
  sanctions: z.array(
    z.object({
      sanction_id: z.string(),
      kind: z.enum(["warning", "mute", "suspend", "ban"]),
      group_name: z.string().nullable(),
      starts_at: z.string(),
      ends_at: z.string().nullable(),
      reason_code: z.string(),
      overturned: z.boolean(),
      appeal_status: z.enum(APPEAL_STATUSES).nullable(),
      can_appeal: z.boolean(),
    }),
  ),
});
export type MyActions = z.infer<typeof myActionsSchema>;

// ---------------------------------------------------------------------------
// Phase 2b: moderators' recent posts, the rota, drills, doctor sessions (staff side, plain English in the page)
// ---------------------------------------------------------------------------
export const modRecentSchema = z.object({
  items: z.array(
    z.object({
      post_id: z.string(),
      group_id: z.string(),
      group_name: z.string(),
      author_handle: z.string(),
      is_reply: z.boolean(),
      body: z.string(),
      state: z.enum(["visible", "held", "auto_hidden"]),
      created_at: z.string(),
      image_id: z.string().nullable(),
    }),
  ),
});
export type ModRecentItem = z.infer<typeof modRecentSchema>["items"][number];

export const coverageSchema = z.object({
  moderator_uncovered_hours: z.number().int(),
  safety_uncovered_hours: z.number().int(),
  gaps: z.array(z.object({ scope: z.enum(["moderator", "safety_reviewer"]), weekday: z.number().int(), hour: z.number().int() })),
});
export type Coverage = z.infer<typeof coverageSchema>;

export const shiftsAdminSchema = z.object({
  staff: z.array(
    z.object({
      staff_id: z.string(),
      name: z.string().nullable(),
      scope: z.enum(["moderator", "safety_reviewer"]),
      all_groups: z.boolean(),
      shifts: z.array(z.object({ weekday: z.number().int(), start_hour: z.number().int(), end_hour: z.number().int() })),
    }),
  ),
});
export type ShiftsAdmin = z.infer<typeof shiftsAdminSchema>;

export const tabletopRunsSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      run_at: z.string(),
      passed: z.boolean(),
      notes: z.string().nullable(),
      run_by_name: z.string().nullable(),
      steps: z.array(z.object({ step: z.string(), ok: z.boolean() })).default([]),
    }),
  ),
});
export type TabletopRuns = z.infer<typeof tabletopRunsSchema>;

export const qaAdminListSchema = z.object({
  sessions: z.array(
    z.object({
      series_id: z.string(),
      title: z.string(),
      opens_at: z.string(),
      closes_at: z.string(),
      cancelled: z.boolean(),
      groups: z.array(z.string()),
      doctors: z.array(z.string()),
      questions: z.number().int(),
      answers: z.number().int(),
    }),
  ),
});
export type QaAdminSession = z.infer<typeof qaAdminListSchema>["sessions"][number];

export const qaDoctorSessionsSchema = z.object({
  sessions: z.array(
    z.object({
      series_id: z.string(),
      title: z.string(),
      intro: z.string(),
      opens_at: z.string(),
      closes_at: z.string(),
      can_answer: z.boolean(),
      questions: z.number().int(),
      unanswered: z.number().int(),
    }),
  ),
});
export type QaDoctorSession = z.infer<typeof qaDoctorSessionsSchema>["sessions"][number];

export const qaDoctorQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      post_id: z.string(),
      group_name: z.string(),
      author_handle: z.string(),
      body: z.string(),
      created_at: z.string(),
      answers: z.array(z.object({ doctor_name: z.string(), body: z.string(), created_at: z.string(), mine: z.boolean() })),
    }),
  ),
});
export type QaDoctorQuestion = z.infer<typeof qaDoctorQuestionsSchema>["questions"][number];

const APPEAL_REFUSED_KEYS = {
  reason_length: "community.appeals.refused.reason_length",
  already_appealed: "community.appeals.refused.already_appealed",
  not_appealable: "community.appeals.refused.not_appealable",
  not_open_yet: "community.appeals.refused.not_appealable",
  safety: "community.appeals.refused.safety",
  contact_details: "community.appeals.refused.contact_details",
} as const satisfies Record<string, MessageKey>;
/** The message for a refused appeal. Total, like the others. */
export function appealRefusalKey(reason: string | undefined): MessageKey {
  return lookup(APPEAL_REFUSED_KEYS, reason, "community.appeals.refused.other");
}

// ---------------------------------------------------------------------------
// Phase 2: staff side (plain English in the page, as the other staff screens)
// ---------------------------------------------------------------------------
export const appealQueueSchema = z.object({
  items: z.array(
    z.object({
      appeal_id: z.string(),
      kind: z.enum(["removal", "sanction"]),
      group_name: z.string(),
      created_at: z.string(),
      member_says: z.string(),
      original_reason_code: z.string().nullable(),
      sanction_kind: z.string().nullable(),
      author_handle: z.string().nullable(),
      body: z.string().nullable(),
    }),
  ),
});
export type AppealItem = z.infer<typeof appealQueueSchema>["items"][number];

export const sampleQueueSchema = z.object({
  items: z.array(
    z.object({
      sample_id: z.string(),
      decision: z.enum(["approved", "removed"]),
      group_name: z.string(),
      author_handle: z.string().nullable(),
      body: z.string().nullable(),
      reason_code: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});
export type SampleItem = z.infer<typeof sampleQueueSchema>["items"][number];

export const qualitySummarySchema = z.object({
  waiting: z.number().int(),
  reviewed_30d: z.number().int(),
  disagreed_30d: z.number().int(),
  appeals_open: z.number().int(),
  appeals_overturned_30d: z.number().int(),
  appeals_decided_30d: z.number().int(),
});
export type QualitySummary = z.infer<typeof qualitySummarySchema>;

export const promptsAdminSchema = z.object({
  prompts: z.array(
    z.object({ id: z.string(), body: z.string(), show_from: z.string(), show_until: z.string().nullable(), showing: z.boolean() }),
  ),
});
export type PromptRow = z.infer<typeof promptsAdminSchema>["prompts"][number];
