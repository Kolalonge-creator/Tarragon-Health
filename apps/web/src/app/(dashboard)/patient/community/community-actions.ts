"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  appealRefusalKey,
  composeOutcome,
  feedSchema,
  groupListSchema,
  hiddenListSchema,
  joinRefusalKey,
  outcomeSchema,
  repliesSchema,
  reportReasonSchema,
  submitResultSchema,
  type ComposeOutcome,
  type Feed,
  type GroupList,
  type HiddenList,
  type Replies,
} from "@/lib/community/model";
import { alertEmergencyContactNow } from "@/app/(dashboard)/patient/actions";

/**
 * Server actions for the patient Community screens (docs/COMMUNITY_SPEC.md).
 *
 * Every action runs as the member's own session. The database decides who the caller is (auth.uid()) and whether they may do the thing:
 * nothing here trusts a group or user id from the browser for authorisation, and no database error text ever reaches the screen. A
 * failure becomes a calm message key; the screen turns it into words with the community.* strings.
 */

const FAILED: MessageKey = "community.compose.refused.other";
const Uuid = z.string().uuid();

export type ActionFailure = { ok: false; key: MessageKey };

function refusalKey(reason: string | undefined): MessageKey {
  return composeOutcome({ status: "refused", ...(reason ? { reason } : {}) }).message;
}

const COMMUNITY_PATH = "/patient/community";
function refresh(): void {
  revalidatePath(COMMUNITY_PATH, "layout");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const FeedInput = z.object({ groupId: Uuid, before: z.string().datetime({ offset: true }).optional() });

/** One page of posts, newest first. `before` is the created_at of the last post already shown. */
export async function loadFeed(input: unknown): Promise<Feed | ActionFailure> {
  const parsed = FeedInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.feed.error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_feed", {
    p_group_id: parsed.data.groupId,
    ...(parsed.data.before ? { p_before: parsed.data.before } : {}),
  });
  if (error) return { ok: false, key: "community.feed.error" };
  const feed = feedSchema.safeParse(data);
  return feed.success ? feed.data : { ok: false, key: "community.feed.error" };
}

export async function loadReplies(input: unknown): Promise<Replies | ActionFailure> {
  const parsed = z.object({ postId: Uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.feed.error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_replies", { p_post_id: parsed.data.postId });
  if (error) return { ok: false, key: "community.feed.error" };
  const replies = repliesSchema.safeParse(data);
  return replies.success ? replies.data : { ok: false, key: "community.feed.error" };
}

// ---------------------------------------------------------------------------
// Joining, leaving, muting
// ---------------------------------------------------------------------------
const JoinInput = z.object({
  groupId: Uuid,
  rulesVersion: z.number().int(),
  rulesAcknowledged: z.literal(true),
  consent: z.literal(true),
});

export type JoinResult = { ok: true; handle: string; avatarCode: string } | ActionFailure;

/** Joining needs both ticks. Without them nothing is sent to the database at all. */
export async function joinGroup(input: unknown): Promise<JoinResult> {
  const parsed = JoinInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.join.refused.consent_needed" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_join_group", {
    p_group_id: parsed.data.groupId,
    p_rules_version: parsed.data.rulesVersion,
    p_consent: true,
  });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success) return { ok: false, key: FAILED };
  if (outcome.data.status !== "joined" || !outcome.data.handle) return { ok: false, key: joinRefusalKey(outcome.data.reason) };
  refresh();
  return { ok: true, handle: outcome.data.handle, avatarCode: outcome.data.avatar_code ?? "" };
}

export async function leaveGroup(input: unknown): Promise<{ ok: true } | ActionFailure> {
  const parsed = z.object({ groupId: Uuid, deletePosts: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_leave_group", { p_group_id: parsed.data.groupId, p_delete_posts: parsed.data.deletePosts });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "left") return { ok: false, key: outcome.success ? refusalKey(outcome.data.reason) : FAILED };
  refresh();
  return { ok: true };
}

export async function setGroupMuted(input: unknown): Promise<{ ok: true; muted: boolean } | ActionFailure> {
  const parsed = z.object({ groupId: Uuid, muted: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_set_group_muted", { p_group_id: parsed.data.groupId, p_muted: parsed.data.muted });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "ok") return { ok: false, key: outcome.success ? refusalKey(outcome.data.reason) : FAILED };
  refresh();
  return { ok: true, muted: outcome.data.notifications_muted ?? parsed.data.muted };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
const SubmitInput = z.object({
  groupId: Uuid,
  parentId: Uuid.nullable(),
  // The length limit lives in the database (read from the group view), never in the app.
  body: z.string().trim().min(1),
  clientRequestId: Uuid,
});

export type SubmitActionResult = { ok: true; outcome: ComposeOutcome } | ActionFailure;

/**
 * Posts or replies. The reply is parsed and turned into what the screen should do by composeOutcome(). For emergency or self-harm
 * language the database withholds the post and this returns kind "safety": the text is not kept anywhere on the server side of this call.
 */
export async function submitPost(input: unknown): Promise<SubmitActionResult> {
  const parsed = SubmitInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.compose.refused.empty" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_submit_post", {
    p_group_id: parsed.data.groupId,
    p_parent_id: parsed.data.parentId as string,
    p_body: parsed.data.body,
    p_client_request_id: parsed.data.clientRequestId,
  });
  if (error) return { ok: false, key: FAILED };
  const result = submitResultSchema.safeParse(data);
  if (!result.success) return { ok: false, key: FAILED };
  const outcome = composeOutcome(result.data);
  if (outcome.kind === "published" || outcome.kind === "held") refresh();
  return { ok: true, outcome };
}

const AskInput = z.object({ groupId: Uuid, sessionId: Uuid, body: z.string().trim().min(1), clientRequestId: Uuid });

/**
 * Sends a question to the doctors of an open question session. The database checks the session is open, the member's limit and the
 * same text filters as any post; the reply is turned into a message by composeOutcome() (qa_closed and qa_limit are mapped there).
 */
export async function askQuestion(input: unknown): Promise<SubmitActionResult> {
  const parsed = AskInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.compose.refused.empty" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_ask_question", {
    p_group_id: parsed.data.groupId,
    p_session_id: parsed.data.sessionId,
    p_body: parsed.data.body,
    p_client_request_id: parsed.data.clientRequestId,
  });
  if (error) return { ok: false, key: FAILED };
  const result = submitResultSchema.safeParse(data);
  if (!result.success) return { ok: false, key: FAILED };
  const outcome = composeOutcome(result.data);
  if (outcome.kind === "published" || outcome.kind === "held") refresh();
  return { ok: true, outcome };
}

export async function editPost(input: unknown): Promise<SubmitActionResult> {
  const parsed = z.object({ postId: Uuid, body: z.string().trim().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.compose.refused.empty" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_edit_post", { p_post_id: parsed.data.postId, p_body: parsed.data.body });
  if (error) return { ok: false, key: FAILED };
  const result = submitResultSchema.safeParse(data);
  if (!result.success) return { ok: false, key: FAILED };
  const outcome = composeOutcome(result.data);
  if (outcome.kind === "published" || outcome.kind === "held") refresh();
  return { ok: true, outcome };
}

export async function deletePost(input: unknown): Promise<{ ok: true } | ActionFailure> {
  const parsed = z.object({ postId: Uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_delete_own_post", { p_post_id: parsed.data.postId });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "deleted") return { ok: false, key: outcome.success ? refusalKey(outcome.data.reason) : FAILED };
  refresh();
  return { ok: true };
}

export async function reactToPost(input: unknown): Promise<{ ok: true; supportCount: number; supported: boolean } | ActionFailure> {
  const parsed = z.object({ postId: Uuid, on: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_react", { p_post_id: parsed.data.postId, p_on: parsed.data.on });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "ok") return { ok: false, key: outcome.success ? refusalKey(outcome.data.reason) : FAILED };
  return { ok: true, supportCount: outcome.data.support_count ?? 0, supported: outcome.data.i_supported ?? parsed.data.on };
}

export type ReportResult = { ok: true; key: MessageKey } | ActionFailure;

export async function reportPost(input: unknown): Promise<ReportResult> {
  const parsed = z.object({ postId: Uuid, reason: reportReasonSchema, detail: z.string().trim().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_report_post", {
    p_post_id: parsed.data.postId,
    p_reason_code: parsed.data.reason,
    ...(parsed.data.detail ? { p_detail: parsed.data.detail } : {}),
  });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success) return { ok: false, key: FAILED };
  if (outcome.data.status === "reported") return { ok: true, key: "community.report.thanks" };
  if (outcome.data.status === "already_reported") return { ok: true, key: "community.report.already" };
  return { ok: false, key: refusalKey(outcome.data.reason) };
}

// ---------------------------------------------------------------------------
// Phase 2: search, digest, hiding a person, appeals
// ---------------------------------------------------------------------------
/**
 * Searches group names, descriptions and topics only (never posts). Outside 2 to 60 characters the database returns the normal list, and
 * so does this: the text is trimmed here and an out-of-range search asks for the plain list instead.
 */
export async function searchGroups(input: unknown): Promise<GroupList | ActionFailure> {
  const parsed = z.object({ q: z.string() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.feed.error" };
  const q = parsed.data.q.trim();
  const supabase = await createClient();
  const { data, error } =
    q.length >= 2 && q.length <= 60 ? await supabase.rpc("community_search_groups", { p_q: q }) : await supabase.rpc("community_list_groups");
  if (error) return { ok: false, key: "community.feed.error" };
  const list = groupListSchema.safeParse(data);
  return list.success ? list.data : { ok: false, key: "community.feed.error" };
}

export async function setDigest(input: unknown): Promise<{ ok: true; on: boolean } | ActionFailure> {
  const parsed = z.object({ groupId: Uuid, on: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_set_digest", { p_group_id: parsed.data.groupId, p_on: parsed.data.on });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "ok") return { ok: false, key: outcome.success ? refusalKey(outcome.data.reason) : FAILED };
  const on = outcome.data["digest_opt_in"];
  return { ok: true, on: typeof on === "boolean" ? on : parsed.data.on };
}

const HIDE_FAILED: MessageKey = "community.post.hide_failed";

/** Hides one person's posts from this member only. The person is never told. The database refuses it for the member's own posts. */
export async function hideAuthor(input: unknown): Promise<{ ok: true } | ActionFailure> {
  const parsed = z.object({ postId: Uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, key: HIDE_FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_hide_author", { p_post_id: parsed.data.postId });
  if (error) return { ok: false, key: HIDE_FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "hidden") return { ok: false, key: HIDE_FAILED };
  refresh();
  return { ok: true };
}

export async function unhideAuthor(input: unknown): Promise<{ ok: true } | ActionFailure> {
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_unhide_author", { p_id: parsed.data.id });
  if (error) return { ok: false, key: FAILED };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success || outcome.data.status !== "ok") return { ok: false, key: FAILED };
  refresh();
  return { ok: true };
}

export async function loadHidden(input: unknown): Promise<HiddenList | ActionFailure> {
  const parsed = z.object({ groupId: Uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.feed.error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_hidden_authors", { p_group_id: parsed.data.groupId });
  if (error) return { ok: false, key: "community.feed.error" };
  const list = hiddenListSchema.safeParse(data);
  return list.success ? list.data : { ok: false, key: "community.feed.error" };
}

/** Asks for a second look at a removed post or an access change. A different moderator decides; the reason text is the member's own. */
export async function submitAppeal(input: unknown): Promise<{ ok: true } | ActionFailure> {
  const parsed = z.object({ kind: z.enum(["removal", "sanction"]), targetId: Uuid, reason: z.string().trim().min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, key: "community.appeals.refused.reason_length" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_appeal", { p_kind: parsed.data.kind, p_target_id: parsed.data.targetId, p_reason: parsed.data.reason });
  if (error) return { ok: false, key: "community.appeals.refused.other" };
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success) return { ok: false, key: "community.appeals.refused.other" };
  if (outcome.data.status !== "ok") return { ok: false, key: appealRefusalKey(outcome.data.reason) };
  revalidatePath("/patient/community/appeals");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Safety card: the person's own explicit tap
// ---------------------------------------------------------------------------
/**
 * "Alert my emergency contact" on the safety card. Runs ONLY from an explicit tap; nothing in the app calls it on its own, because a
 * phrase match cannot tell "my chest is tight now" from "my mum had chest pain last year" (spec section 4.4). It uses the existing
 * emergency path: an emergency_events row, then the same immediate contact alert the site-wide emergency screen uses. The post text is
 * never passed in and never stored on the event.
 *
 * Note for the lead: the spec adds an emergency_source value 'community_post'; until that migration lands the existing generic source is used.
 */
export async function startEmergencyFromSafetyCard(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { ok: false };
  const { data: event, error } = await supabase
    .from("emergency_events")
    .insert({
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      source: "danger_symptom_checklist",
      trigger_detail: "Asked for help from a message",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !event) return { ok: false };
  const alerted = await alertEmergencyContactNow(event.id);
  return { ok: !alerted?.error };
}
