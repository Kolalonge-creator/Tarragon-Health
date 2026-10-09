import type { MessageKey } from "@tarragon/i18n";
import { API_BASE_URL } from "../api";
import { supabase } from "../supabase";
import {
  FAILED_KEY,
  appealRefusalKey,
  composeOutcome,
  joinRefusalKey,
  parseFeed,
  parseGroupList,
  parseGroupView,
  parseHiddenList,
  parseMyActions,
  parseOutcome,
  parseReplies,
  parseSubmitResult,
  refusalKey,
  isSearchQuery,
  APPEAL_MAX_CHARS,
  APPEAL_MIN_CHARS,
  type ComposeOutcome,
  type Feed,
  type GroupList,
  type GroupView,
  type HiddenAuthor,
  type MyActions,
  type ReportReason,
  type Replies,
  type FeedPost,
} from "./model";
import { IMAGES_PATH, interpretUploadResponse, networkFailure, toFormData, type PostUpload, type UploadReply } from "./upload";

/**
 * Every call the Community screens make, as the member (their own Supabase session, so RLS and the functions' own auth.uid() checks
 * decide everything). Mirrors apps/web/src/app/(dashboard)/patient/community/community-actions.ts. Replies are parsed with model.ts; a
 * failure becomes a calm message KEY, never database text. Nothing here needs a notification to succeed.
 */
export type Failure = { ok: false; key: MessageKey; definite: boolean };
export type Done = { ok: true };

const FEED_ERROR: MessageKey = "community.feed.error";
const failure = (key: MessageKey, definite = true): Failure => ({ ok: false, key, definite });

/** A PostgREST answer below 500 is a real answer from the server; no status at all (0) or a 5xx means we do not know what happened. */
function isDefinite(status: number | undefined): boolean {
  return typeof status === "number" && status >= 200 && status < 500;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
/** The group list, or null when it could not be read or did not parse (the screen then says one calm line). */
export async function loadGroupList(): Promise<GroupList | null> {
  const { data, error } = await supabase.rpc("community_list_groups");
  if (error) return null;
  return parseGroupList(data) ?? null;
}

/** Searches group names, descriptions and topics only (never posts). Outside 2 to 60 characters the plain list is asked for instead. */
export async function searchGroups(q: string): Promise<GroupList | null> {
  const text = q.trim();
  if (!isSearchQuery(text)) return loadGroupList();
  const { data, error } = await supabase.rpc("community_search_groups", { p_q: text });
  if (error) return null;
  return parseGroupList(data) ?? null;
}

export async function loadGroupView(slug: string): Promise<GroupView | null> {
  const { data, error } = await supabase.rpc("community_get_group", { p_slug: slug });
  if (error) return null;
  return parseGroupView(data) ?? null;
}

/** One page of posts, newest first. `before` is the created_at of the last post already shown. */
export async function loadFeed(groupId: string, before?: string): Promise<Extract<Feed, { ok: true }> | Failure> {
  const { data, error } = await supabase.rpc("community_feed", { p_group_id: groupId, ...(before ? { p_before: before } : {}) });
  if (error) return failure(FEED_ERROR);
  const feed = parseFeed(data);
  return feed && feed.ok ? feed : failure(FEED_ERROR);
}

export async function loadReplies(postId: string): Promise<{ ok: true; replies: FeedPost[] } | Failure> {
  const { data, error } = await supabase.rpc("community_replies", { p_post_id: postId });
  if (error) return failure(FEED_ERROR);
  const replies: Replies | undefined = parseReplies(data);
  return replies && replies.ok ? replies : failure(FEED_ERROR);
}

export async function loadHidden(groupId: string): Promise<{ ok: true; hidden: HiddenAuthor[] } | Failure> {
  const { data, error } = await supabase.rpc("community_hidden_authors", { p_group_id: groupId });
  if (error) return failure(FEED_ERROR);
  const list = parseHiddenList(data);
  return list && list.ok ? list : failure(FEED_ERROR);
}

export async function loadMyActions(): Promise<MyActions | null> {
  const { data, error } = await supabase.rpc("community_my_actions");
  if (error) return null;
  return parseMyActions(data) ?? null;
}

// ---------------------------------------------------------------------------
// Joining, leaving, muting, the weekly note
// ---------------------------------------------------------------------------
export interface JoinInput {
  groupId: string;
  rulesVersion: number;
  rulesAcknowledged: boolean;
  consent: boolean;
}

/** Joining needs both ticks. Without them nothing is sent to the database at all. */
export async function joinGroup(input: JoinInput): Promise<{ ok: true; handle: string; avatarCode: string } | Failure> {
  if (!input.rulesAcknowledged || !input.consent) return failure("community.join.refused.consent_needed");
  const { data, error } = await supabase.rpc("community_join_group", {
    p_group_id: input.groupId,
    p_rules_version: input.rulesVersion,
    p_consent: true,
  });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  if (outcome.status !== "joined" || !outcome.handle) return failure(joinRefusalKey(outcome.reason));
  return { ok: true, handle: outcome.handle, avatarCode: outcome.avatar_code ?? "" };
}

export async function leaveGroup(groupId: string, deletePosts: boolean): Promise<Done | Failure> {
  const { data, error } = await supabase.rpc("community_leave_group", { p_group_id: groupId, p_delete_posts: deletePosts });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  return outcome.status === "left" ? { ok: true } : failure(refusalKey(outcome.reason));
}

export async function setGroupMuted(groupId: string, muted: boolean): Promise<{ ok: true; muted: boolean } | Failure> {
  const { data, error } = await supabase.rpc("community_set_group_muted", { p_group_id: groupId, p_muted: muted });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  return outcome.status === "ok" ? { ok: true, muted: outcome.notifications_muted ?? muted } : failure(refusalKey(outcome.reason));
}

export async function setDigest(groupId: string, on: boolean): Promise<{ ok: true; on: boolean } | Failure> {
  const { data, error } = await supabase.rpc("community_set_digest", { p_group_id: groupId, p_on: on });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  return outcome.status === "ok" ? { ok: true, on: outcome.digest_opt_in ?? on } : failure(refusalKey(outcome.reason));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
export type SubmitResultOrFailure = { ok: true; outcome: ComposeOutcome } | Failure;

export async function submitPost(input: { groupId: string; parentId: string | null; body: string; clientRequestId: string }): Promise<SubmitResultOrFailure> {
  const body = input.body.trim();
  if (body.length === 0) return failure("community.compose.refused.empty");
  const { data, error, status } = await supabase.rpc("community_submit_post", {
    p_group_id: input.groupId,
    p_parent_id: input.parentId as string,
    p_body: body,
    p_client_request_id: input.clientRequestId,
  });
  if (error) return failure(FAILED_KEY, isDefinite(status));
  const result = parseSubmitResult(data);
  if (!result) return failure(FAILED_KEY, false);
  return { ok: true, outcome: composeOutcome(result) };
}

/** A question for the doctors in an open session. Answers like a post. */
export async function askQuestion(input: { groupId: string; sessionId: string; body: string; clientRequestId: string }): Promise<SubmitResultOrFailure> {
  const body = input.body.trim();
  if (body.length === 0) return failure("community.compose.refused.empty");
  const { data, error, status } = await supabase.rpc("community_ask_question", {
    p_group_id: input.groupId,
    p_session_id: input.sessionId,
    p_body: body,
    p_client_request_id: input.clientRequestId,
  });
  if (error) return failure(FAILED_KEY, isDefinite(status));
  const result = parseSubmitResult(data);
  if (!result) return failure(FAILED_KEY, false);
  return { ok: true, outcome: composeOutcome(result) };
}

export async function editPost(postId: string, body: string): Promise<SubmitResultOrFailure> {
  const text = body.trim();
  if (text.length === 0) return failure("community.compose.refused.empty");
  const { data, error } = await supabase.rpc("community_edit_post", { p_post_id: postId, p_body: text });
  if (error) return failure(FAILED_KEY);
  const result = parseSubmitResult(data);
  if (!result) return failure(FAILED_KEY);
  return { ok: true, outcome: composeOutcome(result) };
}

export async function deletePost(postId: string): Promise<Done | Failure> {
  const { data, error } = await supabase.rpc("community_delete_own_post", { p_post_id: postId });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  return outcome.status === "deleted" ? { ok: true } : failure(refusalKey(outcome.reason));
}

export async function reactToPost(postId: string, on: boolean): Promise<{ ok: true; supportCount: number; supported: boolean } | Failure> {
  const { data, error } = await supabase.rpc("community_react", { p_post_id: postId, p_on: on });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  if (outcome.status !== "ok") return failure(refusalKey(outcome.reason));
  return { ok: true, supportCount: outcome.support_count ?? 0, supported: outcome.i_supported ?? on };
}

export async function reportPost(postId: string, reason: ReportReason, detail: string): Promise<{ ok: true; key: MessageKey } | Failure> {
  const note = detail.trim();
  const { data, error } = await supabase.rpc("community_report_post", {
    p_post_id: postId,
    p_reason_code: reason,
    ...(note ? { p_detail: note } : {}),
  });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  if (!outcome) return failure(FAILED_KEY);
  if (outcome.status === "reported") return { ok: true, key: "community.report.thanks" };
  if (outcome.status === "already_reported") return { ok: true, key: "community.report.already" };
  return failure(refusalKey(outcome.reason));
}

const HIDE_FAILED: MessageKey = "community.post.hide_failed";

/** Hides one person's posts from this member only. The person is never told. */
export async function hideAuthor(postId: string): Promise<Done | Failure> {
  const { data, error } = await supabase.rpc("community_hide_author", { p_post_id: postId });
  if (error) return failure(HIDE_FAILED);
  const outcome = parseOutcome(data);
  return outcome && outcome.status === "hidden" ? { ok: true } : failure(HIDE_FAILED);
}

export async function unhideAuthor(id: string): Promise<Done | Failure> {
  const { data, error } = await supabase.rpc("community_unhide_author", { p_id: id });
  if (error) return failure(FAILED_KEY);
  const outcome = parseOutcome(data);
  return outcome && outcome.status === "ok" ? { ok: true } : failure(FAILED_KEY);
}

/** Asks for a second look at a removed post or an access change. A different moderator decides. */
export async function submitAppeal(kind: "removal" | "sanction", targetId: string, reason: string): Promise<Done | Failure> {
  const text = reason.trim();
  if (text.length < APPEAL_MIN_CHARS || text.length > APPEAL_MAX_CHARS) return failure("community.appeals.refused.reason_length");
  const { data, error } = await supabase.rpc("community_appeal", { p_kind: kind, p_target_id: targetId, p_reason: text });
  if (error) return failure("community.appeals.refused.other");
  const outcome = parseOutcome(data);
  if (!outcome) return failure("community.appeals.refused.other");
  return outcome.status === "ok" ? { ok: true } : failure(appealRefusalKey(outcome.reason));
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------
/** The current Supabase session token, for loading a picture and for the upload. Null if there is no session. */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Sends a post with its one picture. Never throws: no answer at all comes back as a failure that is NOT definite. */
export async function uploadPostWithImage(upload: PostUpload, accessToken: string): Promise<UploadReply> {
  try {
    const response = await fetch(`${API_BASE_URL}${IMAGES_PATH}`, {
      method: "POST",
      // No Content-Type: fetch sets the multipart boundary itself.
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: toFormData(upload),
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return interpretUploadResponse(response.status, json);
  } catch {
    return networkFailure;
  }
}

// ---------------------------------------------------------------------------
// Safety card: the person's own tap on "Alert my emergency contact"
// ---------------------------------------------------------------------------
/**
 * Records an emergency for the signed-in person and messages their saved contact now (POST /api/mobile/community-emergency), exactly
 * what the web card does. Called ONLY from the button; nothing in Community calls it by itself and no post text is sent. Never throws.
 * Whatever the answer, the app then opens its own Emergency card, which confirms the alert or says what is missing (for example, no
 * saved contact).
 */
export async function alertEmergencyContactFromCard(accessToken: string | null): Promise<"sent" | "not_sent" | "failed"> {
  if (!accessToken) return "failed";
  try {
    const response = await fetch(`${API_BASE_URL}/api/mobile/community-emergency`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return "failed";
    const json = (await response.json()) as { contact?: unknown };
    return json.contact === "sent" ? "sent" : "not_sent";
  } catch {
    return "failed";
  }
}
