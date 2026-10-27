"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";

/**
 * S13 R4 (CMO Q13): "I have sought care" / "I could not get care" on the emergency dialog. The answer is stored by
 * record_red_care_response (idempotent by the client id, own account only) and shown to the on-call clinician. It never
 * acknowledges the alert and never stops paging. The caller passes the same client id on a retry so a double tap or a
 * lost reply cannot store it twice.
 *
 * A caregiver acting for the person (the "acting for" account is open) answers through record_red_care_response_for, which the database
 * allows only for a live manage grant that names receive_alerts or log_readings, and which stores the row as the PERSON'S with the helper's
 * id on it. The cookie only says whose account is open; the database re-checks the grant on every call.
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
  const subjectId = await resolveSubjectId(data.user.id);
  const rpc = (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> }).rpc.bind(supabase);
  const { error } =
    subjectId === data.user.id
      ? await rpc("record_red_care_response", {
          p_client_id: clientId,
          p_response: parsed.data.response,
          p_emergency_event: parsed.data.eventId,
        })
      : await rpc("record_red_care_response_for", {
          p_patient: subjectId,
          p_client_id: clientId,
          p_response: parsed.data.response,
          p_emergency_event: parsed.data.eventId,
        });
  // A database message is never shown as written: the only person-readable reasons are ours.
  if (error?.code === "42501") return { ok: false, error: "You are not allowed to answer for this person. They can answer on their own phone, or give you permission.", clientId };
  if (error) return { ok: false, error: "We could not save your answer just now. Please try again.", clientId };
  return { ok: true, clientId };
}
