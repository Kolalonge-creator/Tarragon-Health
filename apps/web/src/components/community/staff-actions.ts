"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toResult } from "./staff-rpc";
import { REMOVE_REASON_CODES, SANCTION_KIND_CODES, type StaffActionResult } from "./staff-types";

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
    decision: z.enum(["approve", "remove"]),
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

