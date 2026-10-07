import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * S52 (INV-05): a self-harm message pages the on-call clinician now. `assistant_page_on_call` (service role) sends the same critical,
 * neutral notification a red-event page uses to whoever is on the rota, or tells the clinical lead and ops and opens an incident when
 * nobody is. It runs IN ADDITION to the emergency escalation the same turn already raises (clinician alert, escalation, care thread).
 *
 * Returns whether the page call itself worked. A failure is logged loudly and never blocks the patient's emergency copy: withholding
 * "go to the nearest hospital" because a write failed would be far worse than losing the page.
 */
export async function pageOnCallForSelfHarm(
  svc: SupabaseClient<Database>,
  patientId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const rpc = (svc as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).rpc.bind(svc);
    const { error } = await rpc("assistant_page_on_call", { p_patient: patientId, p_conversation: conversationId });
    if (error) {
      console.error("ai-coach: on-call page for a self-harm message failed", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("ai-coach: on-call page for a self-harm message threw", error);
    return false;
  }
}
