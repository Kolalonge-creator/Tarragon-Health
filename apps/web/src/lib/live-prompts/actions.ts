"use server";

import { z } from "zod";
import { LIVE_RED_FLAG_RULE_ID, LIVE_RED_FLAG_RULE_VERSION } from "@tarragon/clinical/live-redflag";
import { createClient } from "@/lib/supabase/server";

const RecordSchema = z.object({ encounterId: z.string().uuid(), phrase: z.string().trim().min(3).max(60) });

export type RecordLivePromptResult =
  | { ok: true; id: string }
  | { ok: false; reason: "guard_off" | "no_consent" | "failed" };

/**
 * Record that a red-flag prompt was SHOWN to the consulting clinician. Only the matched list phrase is sent: the transcript segment never leaves
 * the browser (S-10). The database refuses unless the guard is on, the patient's consent stands and the caller is the encounter's clinician.
 * A result, not a thrown error: Next redacts the message of anything a Server Action throws in production.
 */
export async function recordLivePrompt(input: z.input<typeof RecordSchema>): Promise<RecordLivePromptResult> {
  const parsed = RecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "failed" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "record_live_prompt" as never,
    { p_encounter: parsed.data.encounterId, p_phrase: parsed.data.phrase, p_rule_id: LIVE_RED_FLAG_RULE_ID, p_rule_version: LIVE_RED_FLAG_RULE_VERSION } as never,
  );
  if (error) {
    const hint = (error as { hint?: string }).hint ?? "";
    if (hint.includes("go_live_guard:")) return { ok: false, reason: "guard_off" };
    if (hint.includes("consent_required")) return { ok: false, reason: "no_consent" };
    return { ok: false, reason: "failed" };
  }
  return typeof data === "string" ? { ok: true, id: data } : { ok: false, reason: "failed" };
}

/** Put a prompt away. Never behind the guard, so a prompt can always be dismissed. */
export async function dismissLivePrompt(promptId: string): Promise<{ ok: boolean }> {
  const id = z.string().uuid().safeParse(promptId);
  if (!id.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_live_prompt" as never, { p_prompt: id.data } as never);
  return { ok: !error };
}
