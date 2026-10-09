"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { modRecentSchema, staffRefusalText } from "@/lib/community/model";
import { failureMessage, toResult } from "./staff-rpc";
import {
  DISPLAY_NAME_PATTERN, NOTE_MAX, RECENT_REMOVE_REASON_CODES, REMOVE_REASON_CODES, SANCTION_KIND_CODES, type RecentPage, type StaffActionResult,
} from "./staff-types";

/**
 * Moderator and safety-reviewer actions. Shared by the care coordinator page and (later) the admin area. Every input is validated
 * before any call; the database decides who is allowed (auth.uid() inside the function); replies are plain English.
 */

const REFRESH_PATHS = ["/dashboard/care-coordinator/community", "/admin/community"] as const;
function refresh(): void {
  for (const p of REFRESH_PATHS) revalidatePath(p);
}

const INVALID: StaffActionResult = { ok: false, message: "Please check what you entered and try again." };

const decideSchema = z
  .object({
    postId: z.string().uuid(),
    decision: z.enum(["approve", "remove", "send_to_safety"]),
    reasonCode: z.enum(REMOVE_REASON_CODES).optional(),
  })
  .refine((v) => v.decision !== "remove" || v.reasonCode !== undefined, { message: "reason needed" });

export async function modDecideAction(input: unknown): Promise<StaffActionResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_mod_decide", {
    p_post_id: parsed.data.postId,
    p_decision: parsed.data.decision,
    ...(parsed.data.decision === "remove" ? { p_reason_code: parsed.data.reasonCode } : {}),
  });
  const result = toResult(data, error, {
    approved: "Approved. The post is now visible to the group.",
    removed: "Removed. The member has been told their post was taken down.",
    sent_to_safety: "Sent to a safety reviewer. Only a safety reviewer can see this post now.",
  });
  if (result.ok) refresh();
  return result;
}

const sanctionSchema = z
  .object({
    postId: z.string().uuid(),
    kind: z.enum(SANCTION_KIND_CODES),
    reasonCode: z.enum(REMOVE_REASON_CODES),
    hours: z.number().int().min(1).max(8760).optional(),
  })
  .refine((v) => !(v.kind === "mute" || v.kind === "suspend") || v.hours !== undefined, { message: "hours needed" });

export async function modSanctionAction(input: unknown): Promise<StaffActionResult> {
  const parsed = sanctionSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const timed = parsed.data.kind === "mute" || parsed.data.kind === "suspend";
  const supabase = await createClient();
  // Never platform-wide from here: that is an admin's decision, made elsewhere.
  const { data, error } = await supabase.rpc("community_mod_sanction", {
    p_post_id: parsed.data.postId,
    p_kind: parsed.data.kind,
    p_reason_code: parsed.data.reasonCode,
    ...(timed ? { p_hours: parsed.data.hours } : {}),
  });
  const result = toResult(data, error, { ok: "Done. The sanction applies to that member in this group." });
  if (result.ok) refresh();
  return result;
}

const safetySchema = z.object({
  signalId: z.string().uuid(),
  decision: z.enum(["release", "keep_withheld", "close"]),
});

export async function safetyDecideAction(input: unknown): Promise<StaffActionResult> {
  const parsed = safetySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_safety_decide", {
    p_signal_id: parsed.data.signalId,
    p_decision: parsed.data.decision,
  });
  const result = toResult(data, error, {
    released: "Released. The post is now visible to the group.",
    kept_withheld: "Kept withheld. The post stays hidden.",
    closed: "Closed.",
  });
  if (result.ok) refresh();
  return result;
}


/** Blank notes are not sent at all. */
const noteSchema = z.string().trim().max(NOTE_MAX).optional().transform((v) => (v === undefined || v === "" ? undefined : v));

const appealSchema = z.object({
  appealId: z.string().uuid(),
  decision: z.enum(["uphold", "overturn"]),
  note: noteSchema,
});

export async function appealDecideAction(input: unknown): Promise<StaffActionResult> {
  const parsed = appealSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_appeal_decide", {
    p_id: parsed.data.appealId,
    p_decision: parsed.data.decision,
    ...(parsed.data.note !== undefined ? { p_note: parsed.data.note } : {}),
  });
  const result = toResult(data, error, {
    upheld: "Decision upheld. The member has been told the result.",
    overturned: "Decision reversed. The member has been told the result.",
  });
  if (result.ok) refresh();
  return result;
}

const sampleSchema = z.object({
  sampleId: z.string().uuid(),
  agrees: z.boolean(),
  note: noteSchema,
});

export async function sampleReviewAction(input: unknown): Promise<StaffActionResult> {
  const parsed = sampleSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_sample_review", {
    p_id: parsed.data.sampleId,
    p_agrees: parsed.data.agrees,
    ...(parsed.data.note !== undefined ? { p_note: parsed.data.note } : {}),
  });
  const result = toResult(data, error, { ok: "Thank you. Your answer has been saved." });
  if (result.ok) refresh();
  return result;
}

const displayNameSchema = z.object({
  name: z.string().trim().refine((v) => v === "" || DISPLAY_NAME_PATTERN.test(v), { message: "bad name" }),
});

export async function setDisplayNameAction(input: unknown): Promise<StaffActionResult> {
  const parsed = displayNameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: staffRefusalText("bad_name") };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_set_my_display_name", { p_name: parsed.data.name });
  const cleared = parsed.data.name === "";
  const result = toResult(data, error, {
    ok: cleared ? "Done. Members will not see a name for you." : "Saved. Members will see this name and your role.",
  });
  if (result.ok) refresh();
  return result;
}

const recentSchema = z.object({
  before: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "bad time" }),
  groupId: z.string().uuid().optional(),
});

/** The next page of live posts, older than `before`. Moderators only; the database checks that. */
export async function modRecentAction(input: unknown): Promise<RecentPage> {
  const parsed = recentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_mod_recent", {
    p_before: parsed.data.before,
    ...(parsed.data.groupId !== undefined ? { p_group_id: parsed.data.groupId } : {}),
  });
  if (error) return { ok: false, message: failureMessage(error) };
  const page = modRecentSchema.safeParse(data);
  if (!page.success) return { ok: false, message: "That could not be done. Please try again." };
  return { ok: true, items: page.data.items };
}

const removeRecentSchema = z.object({ postId: z.string().uuid(), reasonCode: z.enum(RECENT_REMOVE_REASON_CODES) });

/** Takes down a live post that does not belong. The member is told it was taken down. */
export async function modRemoveRecentAction(input: unknown): Promise<StaffActionResult> {
  const parsed = removeRecentSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_mod_decide", {
    p_post_id: parsed.data.postId,
    p_decision: "remove",
    p_reason_code: parsed.data.reasonCode,
  });
  const result = toResult(data, error, { removed: "Removed. The member has been told their post was taken down." });
  if (result.ok) refresh();
  return result;
}
