"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type HandoverState = { ok?: boolean; error?: boolean; reason?: "wrong_dob" | "needs_verified_phone" | "locked"; attemptsLeft?: number } | undefined;

const schema = z.object({ keep: z.array(z.string().uuid()).max(20), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * The young person finishes the hand-over of their own profile at 18 (v5 1.18). They choose who keeps VIEW access; every
 * other guardian's access ends when this succeeds. The database checks the birthday, that the caller has their own login with a verified phone, that they can confirm their own date of birth (five wrong answers lock it for a day), and
 * that each id really is a guardian; nothing here decides who keeps access except the person themselves.
 */
export async function completeHandoverAction(input: unknown): Promise<HandoverState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: true };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_dependant_handover", { p_keep: parsed.data.keep, p_date_of_birth: parsed.data.dateOfBirth });
  if (error) {
    // The two refusals a person can act on are named; everything else is the generic failure.
    if (error.message?.includes("handover_needs_verified_phone")) return { error: true, reason: "needs_verified_phone" };
    if (error.message?.includes("handover_locked")) return { error: true, reason: "locked" };
    Sentry.captureMessage("complete_dependant_handover failed", { level: "warning", tags: { pg_code: error.code ?? "none" } });
    return { error: true };
  }
  const result = data as { ok?: boolean; reason?: string; attempts_left?: number } | null;
  if (result?.ok === false) return { error: true, reason: "wrong_dob", attemptsLeft: result.attempts_left ?? 0 };
  revalidatePath("/patient");
  revalidatePath("/patient/privacy");
  return { ok: true };
}
