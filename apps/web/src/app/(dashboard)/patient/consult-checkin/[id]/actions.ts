"use server";

import { createClient } from "@/lib/supabase/server";
import { answerInputSchema, checkinOutcomeSchema, type CheckinOutcome } from "@/lib/consult-checkin/model";

export type SubmitCheckinResult = { ok: true; outcome: CheckinOutcome } | { ok: false; reason: "invalid" | "signed_out" | "not_open" | "failed" };

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

/**
 * The patient sends their check-in. Everything that matters (own check-in only, open only, the answers valid for the configuration it was created
 * under, the danger-phrase screen, the alert) is decided in the database function; this only validates the shape and passes it on. A result is a
 * short reason code, never a database message.
 */
export async function submitCheckinAction(input: unknown): Promise<SubmitCheckinResult> {
  const parsed = answerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out" };
  const { data, error } = await (supabase as unknown as Rpc).rpc("answer_post_consult_checkin", {
    p_id: parsed.data.checkinId,
    p_answers: parsed.data.answers,
    p_free_text: parsed.data.note?.trim() ? parsed.data.note : null,
  });
  if (error) return { ok: false, reason: error.code === "22023" ? "not_open" : error.code === "P0002" ? "not_open" : "failed" };
  const outcome = checkinOutcomeSchema.safeParse(data);
  if (!outcome.success) return { ok: false, reason: "failed" };
  return { ok: true, outcome: outcome.data };
}
