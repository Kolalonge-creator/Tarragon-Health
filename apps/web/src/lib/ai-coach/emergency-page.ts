import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantPagingWaits, type Database } from "@tarragon/shared";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * S52 (INV-05): a self-harm message pages the on-call clinician now. `assistant_page_on_call` (service role) sends the same critical,
 * neutral notification a red-event page uses to whoever is on the rota, or tells the clinical lead and ops and opens an incident when
 * nobody is. It runs IN ADDITION to the emergency escalation the same turn already raises (clinician alert, escalation, care thread).
 *
 * DURABLE, not hopeful: (1) a small queue row is committed FIRST (assistant_page_enqueue), so a page that is cut off, frozen or times out
 * is found and retried (assistant_page_retry_due, run by every later self-harm page and by the daily cron); (2) the page is
 * awaited for a bounded time (assistant.paging page_wait_ms) so the reply can say "someone has been told" only when that is true; (3) if it
 * is still running when the wait ends, it is kept alive past the response with Next's after(). The page marks its queue row done itself.
 *
 * Returns true only when someone was really notified. A failure is logged loudly and never blocks the patient's emergency copy: withholding
 * "go to the nearest hospital" because a write failed would be far worse than losing the page.
 */
export async function pageOnCallForSelfHarm(
  svc: SupabaseClient<Database>,
  patientId: string,
  conversationId: string,
): Promise<boolean> {
  const rpc = (svc as unknown as { rpc: Rpc }).rpc.bind(svc);
  const { pageWaitMs } = assistantPagingWaits();
  try {
    const queued = await rpc("assistant_page_enqueue", { p_patient: patientId, p_conversation: conversationId });
    if (queued.error) console.error("ai-coach: could not queue the on-call page (the page is still attempted)", queued.error.message);
  } catch (error) {
    console.error("ai-coach: queueing the on-call page threw (the page is still attempted)", error);
  }

  const work: Promise<boolean> = (async () => {
    try {
      const { data, error } = await rpc("assistant_page_on_call", { p_patient: patientId, p_conversation: conversationId });
      if (error) {
        console.error("ai-coach: on-call page for a self-harm message failed", error.message);
        return false;
      }
      // Read what the database says it did: true only when someone (the clinician on call, or the clinical lead and ops) was really notified.
      const result = (data ?? {}) as { notified?: boolean };
      if (result.notified !== true) console.error("ai-coach: on-call page for a self-harm message reached nobody", JSON.stringify(result));
      return result.notified === true;
    } catch (error) {
      console.error("ai-coach: on-call page for a self-harm message threw", error);
      return false;
    }
  })();

  // Every page also sweeps any OTHER page that was cut off earlier (best effort, after the response; the daily cron is the last line).
  try {
    after(async () => {
      await rpc("assistant_page_retry_due", {}).catch(() => undefined);
    });
  } catch {
    // not inside a request
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    work,
    new Promise<"waiting">((resolve) => {
      timer = setTimeout(() => resolve("waiting"), pageWaitMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (first === "waiting") {
    // Still running: keep it alive after the response goes out (serverless would otherwise freeze it); its queue row stays pending until it ends.
    try {
      after(() => work.then(() => undefined));
    } catch {
      // not inside a request (a test, a script): the queue row is the safety net
    }
    return false;
  }
  return first;
}
