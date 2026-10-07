"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type HandoverState = { ok?: boolean; error?: boolean } | undefined;

const schema = z.object({ keep: z.array(z.string().uuid()).max(20) });

/**
 * The young person finishes the hand-over of their own profile at 18 (v5 1.18). They choose who keeps VIEW access; every
 * other guardian's access ends when this succeeds. The database checks the birthday, that the caller has their own login, and
 * that each id really is a guardian; nothing here decides who keeps access except the person themselves.
 */
export async function completeHandoverAction(input: unknown): Promise<HandoverState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: true };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_dependant_handover", { p_keep: parsed.data.keep });
  if (error) {
    Sentry.captureMessage("complete_dependant_handover failed", { level: "warning", tags: { pg_code: error.code ?? "none" } });
    return { error: true };
  }
  revalidatePath("/patient");
  revalidatePath("/patient/privacy");
  return { ok: true };
}
