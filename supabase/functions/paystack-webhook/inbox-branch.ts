// S14x: the provider event inbox branch of the Paystack webhook, behind the flag `provider_inbox_paystack` (default OFF; the old path
// stays the default and is untouched). With the flag on:
//   1. The signature verdict and the raw body are stored in provider_events FIRST, keyed by event type + the reference it is about.
//      A bad signature is stored 'rejected' and answered exactly as the old path answers it (200, so Paystack does not retry-storm);
//      it is never dispatched.
//   2. A verified event is claimed under a lease and handed to the SAME processing code the old path runs (processVerifiedEvent).
//      The old path's own payment_transactions idempotency stays in place underneath, so there are two independent guards.
//   3. The inbox row records the outcome. A dispatch the old code reports as a failure (any 5xx, or ok:false except the cases it
//      deliberately answers 200) is marked failed and Paystack's retry or the drain function runs it again.
//   4. If the inbox cannot be written the answer is 500 (Paystack retries) and NOTHING is processed. That is the opposite of
//      the Resend and Zoom adoption, on purpose: for money, "stored first" is the point, and Paystack retries for 72 hours.
// Known limit: the old path's payment_transactions row is the primary dedupe for events it has already seen, so an admin REPLAY of an
// event it recorded as failed will find that row and answer "replay" without redoing the work. Replay is therefore only a real
// re-run for events the old path never recorded (a crash before the insert) or recorded and then deleted (the transfer branch does
// this on purpose so redelivery works). Documented in docs/design/S11-S15-p4-providers.md; resolving it means moving that dedupe into
// the inbox, which is a change to the money path and is left for the flag-on soak.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { featureFlagOn, type FlagReader } from "../_shared/integrations/flag.ts";
import { paystackEventKey, receiveProviderEvent, supabaseInboxStore, type DispatchOutcome } from "../_shared/integrations/webhook-inbox.ts";

export const PROVIDER_INBOX_FLAG = "provider_inbox_paystack";

export function providerInboxEnabled(supabase: SupabaseClient): Promise<boolean> {
  return featureFlagOn(supabase as unknown as FlagReader, PROVIDER_INBOX_FLAG);
}

/** Turns what the old handler answered into an inbox outcome. 5xx and the explicit failure bodies are retryable. */
export async function outcomeOfResponse(res: Response): Promise<DispatchOutcome> {
  if (res.status >= 500) return { ok: false, error: `handler answered ${res.status}` };
  const body = await res.clone().json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (body && body.ok === false) {
    // Answered 200 on purpose by the old path: nothing a retry can fix (unidentifiable refund, bad JSON). Kept as a permanent failure so it is visible.
    const permanent = body.error === "refund_unidentifiable" || body.error === "invalid_json";
    return { ok: false, error: body.error ?? "handler reported a failure", permanent };
  }
  return { ok: true };
}

export async function handleViaInbox(
  rawBody: string,
  _signatureHeader: string | null,
  signatureValid: boolean,
  supabase: SupabaseClient,
  process: (event: unknown) => Promise<Response>,
): Promise<Response> {
  const store = supabaseInboxStore(supabase);
  let response: Response | null = null as Response | null;
  const out = await receiveProviderEvent(
    store,
    { provider: "paystack", rawBody, verified: signatureValid, derive: () => paystackEventKey(rawBody) },
    async () => {
      let event: unknown;
      try {
        event = JSON.parse(rawBody);
      } catch {
        response = Response.json({ ok: false, error: "invalid_json" }, { status: 200 });
        return { ok: false, error: "invalid_json", permanent: true };
      }
      response = await process(event);
      return await outcomeOfResponse(response);
    },
  );
  switch (out.kind) {
    case "rejected":
      return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
    case "store_unavailable":
      console.error("paystack-webhook: provider inbox unavailable, asking Paystack to retry", out.error);
      return Response.json({ ok: false, error: "inbox_unavailable" }, { status: 500 });
    case "duplicate":
      return Response.json({ ok: true, replay: true });
    case "processed":
    case "failed":
      // The response the old code produced is the answer, so the provider sees exactly what the old path would have said.
      // No response at all means the handler threw: the event is stored and failed, and Paystack is asked to retry.
      return response ?? Response.json({ ok: false, error: "handler_failed" }, { status: 500 });
  }
}
