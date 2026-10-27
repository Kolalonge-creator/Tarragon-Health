import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { floorForAnswer } from "@tarragon/symptom-triage-engine";
import { isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import {
  answerInputSchema,
  answerOutcomeSchema,
  checkbackViewSchema,
  type CheckbackView,
  type SubmitCheckbackResult,
} from "./model";

/**
 * S59c: reading and answering a follow-up after a symptom check. Shared by the web server action and the bearer-authenticated mobile route,
 * so the two cannot disagree. The caller supplies a client that acts as the signed-in person.
 *
 * FAIL TOWARD ESCALATION. The red-flag floor is re-run HERE on the original answers plus anything the person newly ticked, from the stored
 * capture (never from a value the client sent), and its category is handed to the database function, which can only raise the action from it.
 * If the floor cannot be evaluated and the person ticked anything, the answer is treated as "urgent", never as nothing.
 */
type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

export async function readCheckbackView(supabase: SupabaseClient, id: string): Promise<CheckbackView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await (supabase as unknown as Rpc).rpc("my_symptom_checkback", { p_id: id });
  if (error || !data) return null;
  const parsed = checkbackViewSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

// The floor re-run itself lives in the engine package (one copy, shared with the phone): `floorForAnswer`.
export { floorForAnswer };

export async function answerCheckback(supabase: SupabaseClient, userId: string | null, input: unknown): Promise<SubmitCheckbackResult> {
  const parsed = answerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (!userId) return { ok: false, reason: "signed_out" };
  // INV-14: closed means closed (the database refuses as well)
  if (!(await isSymptomCheckerOpen(supabase as never))) return { ok: false, reason: "closed" };
  const view = await readCheckbackView(supabase, parsed.data.checkbackId);
  if (!view) return { ok: false, reason: "not_open" };
  if (view.state !== "open" && view.state !== "expired") return { ok: false, reason: "not_open" };
  // a sign must come from this pathway's own vocabulary (the database checks again)
  const signs = [...new Set(parsed.data.signs)];
  if (signs.some((s) => !view.sign_vocabulary.includes(s))) return { ok: false, reason: "invalid" };
  const floor = floorForAnswer(view.capture, signs);
  const { data, error } = await (supabase as unknown as Rpc).rpc("answer_symptom_checkback", {
    p_id: parsed.data.checkbackId,
    p_progress: parsed.data.progress,
    p_care: parsed.data.care ?? null,
    p_new_signs: signs,
    p_floor_category: floor,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, reason: "closed" };
    if (error.code === "55000" || error.code === "P0002") return { ok: false, reason: "not_open" };
    if (error.code === "22023") return { ok: false, reason: "invalid" };
    Sentry.captureException(new Error(`symptom follow-up answer failed: ${error.message}`), { extra: { checkback: parsed.data.checkbackId } });
    return { ok: false, reason: "failed" };
  }
  const outcome = answerOutcomeSchema.safeParse(data);
  if (!outcome.success) return { ok: false, reason: "failed" };
  return { ok: true, outcome: outcome.data, complaintKey: view.complaint_key };
}
