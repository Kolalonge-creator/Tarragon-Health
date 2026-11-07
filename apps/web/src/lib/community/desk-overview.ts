import { z } from "zod";
import type { StaffContext } from "./model";

/**
 * The shared Community desk's Overview (decision COM-31). The data comes from public.community_desk_overview(days), which returns no
 * member identity. Everything here is pure so it can be tested without a database.
 */

export const DESK_PERIODS = [1, 7, 30, 90] as const;
export type DeskPeriod = (typeof DESK_PERIODS)[number];

export function parsePeriod(raw: string | undefined): DeskPeriod {
  const n = Number(raw);
  return (DESK_PERIODS as readonly number[]).includes(n) ? (n as DeskPeriod) : 7;
}

export const PERIOD_LABEL: Readonly<Record<DeskPeriod, string>> = { 1: "Today", 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days" };

const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

const count = z.number().int().nonnegative();

export const attentionItemSchema = z.object({
  priority: z.enum(PRIORITIES),
  category: z.string(),
  label: z.string(),
  count: count.optional(),
  group_name: z.string().nullable().optional(),
  received_at: z.string().nullable().optional(),
  status: z.string(),
  owner: z.string().nullable().optional(),
  overdue: z.boolean().default(false),
  next_action: z.string(),
  href: z.string().nullable().optional(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const deskOverviewSchema = z.object({
  days: z.number().int(),
  generated_at: z.string(),
  local_hour: z.number().int(),
  sees_safety: z.boolean(),
  attention: z.array(attentionItemSchema),
  kpis: z.object({
    members_active: count,
    members_new: count,
    members_new_prev: count,
    groups_active: count,
    posts_today: count,
    posts_yesterday: count,
    awaiting_moderation: count,
    open_reports: count,
    open_safety: count,
    response_minutes_median: z.number().nullable(),
    response_decisions: count,
    moderators_on_duty: count,
    safety_on_duty: count,
  }),
  series: z
    .array(
      z.object({
        day: z.string(),
        posts: count,
        blocked: count,
        held: count,
        reported: count,
        auto_hidden: count,
        approved: count,
        removed: count,
        safety: count,
      }),
    )
    .nullable()
    .transform((v) => v ?? []),
  groups: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      status: z.string(),
      images_allowed: z.boolean(),
      members: count,
      members_new: count,
      posts: count,
      replies: count,
      reports: count,
      outstanding: count,
      safety_open: count,
    }),
  ),
  staff: z.array(
    z.object({
      name: z.string(),
      scopes: z.array(z.string()),
      group_scoped: z.boolean(),
      on_duty: z.boolean(),
      actions: count,
      last_action_at: z.string().nullable(),
    }),
  ),
  waiting: z.object({ queue: count, queue_overdue: count, appeals: count, queue_overdue_minutes: z.number().int() }),
  activity: z.array(
    z.object({ action: z.string(), at: z.string(), automated: z.boolean(), group_name: z.string().nullable(), actor: z.string().nullable() }),
  ),
  last_drill: z.object({ at: z.string(), passed: z.boolean() }).nullable(),
});
export type DeskOverview = z.infer<typeof deskOverviewSchema>;

const RANK: Readonly<Record<Priority, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Most urgent first; within a priority, overdue first, then oldest first (an item with no time sorts last). */
export function sortAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (RANK[a.priority] !== RANK[b.priority]) return RANK[a.priority] - RANK[b.priority];
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ta = a.received_at ? Date.parse(a.received_at) : Number.POSITIVE_INFINITY;
    const tb = b.received_at ? Date.parse(b.received_at) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

/**
 * Where an attention item's "Open" goes. The database names a desk-relative target; pages that are not on the desk yet live in the
 * admin or CMO area, which only those people can open, so nobody is sent to a page that would bounce them.
 */
export function attentionHref(target: string | null | undefined, ctx: StaffContext): string | null {
  if (!target) return null;
  // the queue tabs open only for someone who can act there: the safety tab for a safety reviewer (the CMO counts, by tier), the others
  // for a moderator. An admin with no grant sees the item and its owner, but no button that would land on "no duties".
  if (target === "queue?tab=safety") return ctx.is_safety_reviewer ? `/community-desk/${target}` : null;
  if (target.startsWith("queue")) return ctx.is_moderator ? `/community-desk/${target}` : null;
  if (target === "rota") return ctx.is_admin ? "/admin/community/rota" : null;
  if (target === "drills") return ctx.is_admin ? "/admin/community/drill" : ctx.is_cmo ? "/clinician/community/drill" : null;
  return null;
}

export type Trend = { direction: "up" | "down" | "flat"; text: string };

/** A comparison with the previous equal period. With no earlier figure there is no trend: we never invent a baseline. */
export function trend(current: number, previous: number | null | undefined, previousLabel: string): Trend | null {
  if (previous === null || previous === undefined) return null;
  if (current === previous) return { direction: "flat", text: `Same as ${previousLabel}` };
  const diff = current - previous;
  return { direction: diff > 0 ? "up" : "down", text: `${diff > 0 ? "+" : ""}${diff} on ${previousLabel}` };
}

/** "45 min", "3 h 5 min", "2 days". Null means there were no decisions to measure. */
export function formatMinutes(min: number | null): string {
  if (min === null) return "No decisions yet";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(min / (24 * 60))} days`;
}

/** How long ago, in plain words, for the attention panel. */
export function elapsed(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

const ACTION_LABEL: Readonly<Record<string, string>> = {
  approved: "Post approved",
  removed: "Post removed",
  held: "Post held by the automatic checks",
  blocked: "Post blocked (contact details)",
  auto_hidden: "Post hidden after reports",
  withheld_safety: "Post withheld for safety review",
  sent_to_safety: "Sent to safety review",
  split_to_post: "Reply made its own post",
  appeal_opened: "Appeal opened",
  staff_granted: "Community role given",
  staff_revoked: "Community role withdrawn",
  staff_granted_automatically: "Community role given automatically (before 7 Nov)",
  rota_changed: "Rota changed",
  tabletop_passed: "Safety drill recorded",
  rules_approved: "Group rules approved",
  rule_set_activated: "Filter rules switched on",
  group_created: "Group created",
  images_enabled: "Pictures switched on for a group",
  image_flagged: "Picture flagged for a moderator",
  sample_reviewed: "Second look done",
  unmasked: "Member looked up (recorded)",
  cooldown_started: "Posting paused after blocked attempts",
  qa_created: "Doctor question session created",
  qa_answered: "Doctor answered a question",
  qa_answer_removed: "Doctor answer removed",
  qa_cancelled: "Doctor question session cancelled",
  prompt_saved: "Conversation prompt saved",
  prompt_ended: "Conversation prompt ended",
  dpo_named: "Lookup notice list changed",
  starter_safety_rules_loaded: "Starter safety rules loaded",
};

/** Plain words for an event. Families like appeal_upheld and sanction_mute share a prefix; anything unknown is shown tidied, never dropped. */
export function actionLabel(action: string): string {
  if (Object.hasOwn(ACTION_LABEL, action)) return ACTION_LABEL[action];
  if (action.startsWith("appeal_")) return "Appeal decided";
  if (action.startsWith("sanction_")) return "Sanction applied";
  if (action.startsWith("safety_")) return "Safety decision recorded";
  const words = action.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const SCOPE_LABEL: Readonly<Record<string, string>> = {
  moderator: "Moderator",
  senior_moderator: "Senior moderator",
  safety_reviewer: "Safety reviewer",
};
