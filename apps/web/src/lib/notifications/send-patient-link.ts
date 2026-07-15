/**
 * Server-only Termii SMS sender for links generated inside a Next.js server
 * action (e.g. a Zoom join_url) — never import from a "use client" file.
 *
 * supabase/functions/abnormal-result-handler/index.ts's sendWithFallback()
 * (WhatsApp template first, Termii SMS fallback) can't be reused here: it
 * runs in an isolated Deno runtime that can't be called from Next.js server
 * code, and WhatsApp Cloud API requires a pre-approved message template for
 * every distinct message shape — there is no approved template yet for "a
 * video call join link" (see the project's existing pending-Meta-template-
 * review precedent). SMS has no such approval gate, so this sends via
 * Termii only for now; WhatsApp delivery of a join link is a flagged
 * fast-follow once a template exists, not something to fake by misusing an
 * unrelated approved template.
 *
 * Same never-throw contract as lib/paystack/client.ts: any network error,
 * timeout, non-2xx, or missing config resolves to `{ ok: false, error }`.
 */

export type SendPatientLinkResult = { ok: true } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 10_000;

export async function sendPatientLinkSms(toPhone: string, text: string): Promise<SendPatientLinkResult> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "TERMII_API_KEY is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: toPhone,
        from: "Tarragon",
        sms: text,
        type: "plain",
        channel: "generic",
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `Termii request failed with status ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown Termii request failure" };
  } finally {
    clearTimeout(timer);
  }
}
