"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * S13 R4 (CMO Q13): "I have sought care" / "I could not get care" on the emergency dialog. The answer is stored by
 * record_red_care_response (idempotent by the client id, own account only) and shown to the on-call clinician. It never
 * acknowledges the alert and never stops paging. The caller passes the same client id on a retry so a double tap or a
 * lost reply cannot store it twice.
 */
const inputSchema = z.object({
  eventId: z.string().uuid(),
  response: z.enum(["sought_care", "could_not_get_care"]),
  clientId: z.string().uuid().optional(),
});

export type RedCareActionResult = { ok: true; clientId: string } | { ok: false; error: string; clientId: string };

export async function recordRedCareResponse(input: z.input<typeof inputSchema>): Promise<RedCareActionResult> {
  const clientId = (input as { clientId?: string }).clientId ?? randomUUID();
  const parsed = inputSchema.safeParse({ ...input, clientId });
  if (!parsed.success) return { ok: false, error: "We could not save your answer. Please try again.", clientId };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Please sign in again.", clientId };
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> })
    .rpc("record_red_care_response", {
      p_client_id: clientId,
      p_response: parsed.data.response,
      p_emergency_event: parsed.data.eventId,
    });
  // A database message is never shown as written: the only person-readable reasons are ours.
  if (error) return { ok: false, error: "We could not save your answer just now. Please try again.", clientId };
  return { ok: true, clientId };
}
