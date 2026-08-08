import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";
import { WEBHOOK_PROVIDERS } from "@/lib/wearables/providers";
import { processWebhookPayload } from "@/lib/wearables/sync";
import { handleVerificationChallenge, verifyWebhookRequest } from "@/lib/wearables/webhook-auth";

/**
 * Wearable webhook ingestion boundary — the ingestion-boundary rule's other
 * half (CLAUDE.md: consumer platform sync via cloud APIs/webhooks).
 *
 * This route used to be a best-effort scaffold that stored only whatever a
 * provider happened to include inline and acked. That covered Garmin, which
 * pushes summaries outright, and nothing else: Fitbit, WHOOP and Oura all
 * send notify-only events whose measurements exist solely behind an
 * authenticated follow-up GET. That fetch now happens (lib/wearables/sync.ts
 * + the per-provider adapters), using the connection's stored access token
 * and refreshing it when it has expired.
 *
 * Dexcom is deliberately excluded: its v3 API is poll-only with no webhook
 * mechanism, so nothing will ever POST here for it. Its readings come from
 * the scheduled sweep at api/cron/wearable-sync instead.
 *
 * Two things this route will not do:
 *  - accept an unauthenticated POST. Every provider is verified first (see
 *    webhook-auth.ts); an endpoint that writes into vitals_readings is not
 *    somewhere to fail open.
 *  - return non-2xx once a request has authenticated. An unrecognised but
 *    genuine payload is acked so the provider doesn't retry it forever; the
 *    counters in the response body are how a shape mismatch is diagnosed.
 *
 * The follow-up fetches happen inline, before the ack. That is a deliberate
 * trade: a provider that times out its delivery will retry, and a retry is
 * harmless here because every reading dedupes on its own external id — so
 * the cost of being slow is repeated work, never duplicated data. Doing it
 * the other way (ack first, work after) would be faster and strictly worse:
 * a serverless invocation can be torn down the moment its response is sent,
 * silently dropping the reading with the provider believing it delivered.
 * The outbound calls are bounded (5s each, see providers/http.ts) and the
 * per-request notification count is capped below.
 */

function isWebhookProvider(value: string): value is CloudOAuthWearableProvider {
  return (WEBHOOK_PROVIDERS as string[]).includes(value);
}

/**
 * Subscription-registration handshake. Fitbit and Oura both refuse to create
 * a subscription until this answers correctly, so it is a prerequisite for
 * setup rather than an extra.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const { provider } = await params;
  if (!isWebhookProvider(provider)) {
    return new Response(null, { status: 404 });
  }
  return handleVerificationChallenge(provider, request) ?? new Response(null, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params;
  if (!isWebhookProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  // The raw text, not request.json(): every signature is computed over the
  // exact bytes sent, and re-serialising parsed JSON would not reproduce them.
  const rawBody = await request.text();

  const auth = verifyWebhookRequest(provider, request, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const outcome = await processWebhookPayload(svc, provider, body);

  return NextResponse.json({ ok: true, ...outcome });
}
