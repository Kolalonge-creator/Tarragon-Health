"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeReviewError } from "./review-errors";

/**
 * The quarterly staff access review (security audit 2026-11-05, Phase 3). Every rule is enforced in the database functions
 * (admin only, one open review, a note for remove or change, every account decided before completion); these actions only
 * validate the form and pass a database refusal through as plain words. Recording "remove" changes no permission: the admin
 * then acts on the member's own page.
 */
export type ReviewActionState = { error?: string; message?: string } | undefined;

interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const PATH = "/admin/staff-access-review";

export async function startReview(): Promise<ReviewActionState> {
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("start_staff_access_review");
  if (error) return { error: safeReviewError(error) };
  revalidatePath(PATH);
  return { message: "Review started. Decide each account below." };
}

const decideSchema = z
  .object({
    itemId: z.string().uuid(),
    decision: z.enum(["keep", "remove", "change"]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "keep" && (v.note ?? "").length < 5) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say in a few words what should change and why." });
    }
  });

export async function decideItem(_prev: ReviewActionState, form: FormData): Promise<ReviewActionState> {
  const parsed = decideSchema.safeParse({
    itemId: form.get("itemId"),
    decision: form.get("decision"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the decision and try again." };
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("decide_staff_access_review_item", {
    p_item: parsed.data.itemId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: safeReviewError(error) };
  revalidatePath(PATH);
  return { message: "Saved." };
}

const completeSchema = z.object({ reviewId: z.string().uuid() });

export async function completeReview(_prev: ReviewActionState, form: FormData): Promise<ReviewActionState> {
  const parsed = completeSchema.safeParse({ reviewId: form.get("reviewId") });
  if (!parsed.success) return { error: "That review could not be found." };
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("complete_staff_access_review", { p_review: parsed.data.reviewId });
  if (error) return { error: safeReviewError(error) };
  revalidatePath(PATH);
  revalidatePath("/admin/security");
  return { message: "Review complete. The next one is due in about three months." };
}
