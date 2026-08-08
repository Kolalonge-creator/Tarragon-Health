import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getWearableClientCredentials, type CloudOAuthWearableProvider } from "./oauth-providers";

/**
 * Authenticating an inbound wearable webhook.
 *
 * The scaffold this replaces accepted any POST that happened to reach the
 * route. That was harmless only because no provider had credentials and so
 * nothing real was ever going to arrive — the moment a subscription exists,
 * an unauthenticated public endpoint that writes into vitals_readings is a
 * way for anyone on the internet to inject clinical-looking readings into a
 * patient's record, which is exactly the sort of thing the escalation
 * pipeline then acts on.
 *
 * The four webhook providers split into two groups:
 *
 *  - Fitbit and WHOOP sign the request body with the app's client secret, so
 *    the signature is verified directly.
 *  - Oura and Garmin sign nothing at all. Their documented protection is a
 *    subscription-time verification token (Oura) or IP allow-listing
 *    (Garmin), neither of which authenticates an individual POST. For those
 *    two the callback URL registered with the provider carries a shared
 *    secret this route requires — a bearer-secret-in-the-URL, which is the
 *    standard mitigation for an unsigned webhook and is why the secret must
 *    be treated as a credential (rotate it if the URL leaks). No patient
 *    data is ever in that URL, only the secret.
 *
 * A provider whose secret isn't configured cannot be verified, and an
 * unverifiable webhook is rejected rather than trusted — a "fail open when
 * unconfigured" default here would mean the endpoint is wide open on exactly
 * the day someone points a subscription at it before finishing setup.
 */

export type WebhookAuthResult = { ok: true } | { ok: false; status: number; error: string };

/** WHOOP signs `timestamp + body`; anything older than this is a replay of a
 * request that was already delivered. */
const WHOOP_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const SHARED_SECRET_ENV: Partial<Record<CloudOAuthWearableProvider, string>> = {
  oura: "OURA_WEBHOOK_SECRET",
  garmin: "GARMIN_WEBHOOK_SECRET",
};

export function verifyWebhookRequest(
  provider: CloudOAuthWearableProvider,
  request: Request,
  rawBody: string
): WebhookAuthResult {
  if (provider === "fitbit") return verifyFitbit(request, rawBody);
  if (provider === "whoop") return verifyWhoop(request, rawBody);
  if (provider === "oura") return verifyOura(request, rawBody);
  return verifySharedSecret(provider, request);
}

/**
 * Oura is the ambiguous one. Its own rendered docs could not be read to
 * confirm, but multiple independent client libraries state that Oura sends
 * an `x-oura-signature` HMAC keyed with the app's client secret. Rather than
 * bet on either answer: if that header is present it must verify (a present
 * signature is never ignored, so a real signature can't be bypassed by an
 * attacker simply omitting it — omitting it falls through to the shared
 * secret, which they also do not have). If it is absent, the shared secret
 * on the registered callback URL is required as before.
 *
 * Once a real Oura subscription confirms which it is, delete the branch that
 * turns out to be dead rather than leaving both.
 */
function verifyOura(request: Request, rawBody: string): WebhookAuthResult {
  const provided = request.headers.get("x-oura-signature");
  if (!provided) return verifySharedSecret("oura", request);

  const credentials = getWearableClientCredentials("oura");
  if (!credentials) {
    return { ok: false, status: 503, error: "Oura credentials not configured" };
  }
  const expected = createHmac("sha256", credentials.clientSecret).update(rawBody).digest("hex");
  const expectedBase64 = createHmac("sha256", credentials.clientSecret).update(rawBody).digest("base64");
  // Encoding is undocumented in what could be retrieved, so both standard
  // encodings are accepted; each comparison is still constant-time and an
  // attacker must produce a correct HMAC either way.
  return constantTimeEquals(provided, expected) || constantTimeEquals(provided, expectedBase64)
    ? { ok: true }
    : { ok: false, status: 401, error: "Bad signature" };
}

/**
 * Fitbit: base64 HMAC-SHA1 of the raw body, keyed with the client secret
 * followed by an ampersand (an OAuth1-era convention Fitbit kept), in the
 * `X-Fitbit-Signature` header.
 */
function verifyFitbit(request: Request, rawBody: string): WebhookAuthResult {
  const credentials = getWearableClientCredentials("fitbit");
  if (!credentials) {
    return { ok: false, status: 503, error: "Fitbit credentials not configured" };
  }
  const provided = request.headers.get("x-fitbit-signature");
  if (!provided) return { ok: false, status: 401, error: "Missing X-Fitbit-Signature" };

  const expected = createHmac("sha1", `${credentials.clientSecret}&`).update(rawBody).digest("base64");
  return constantTimeEquals(provided, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Bad signature" };
}

/**
 * WHOOP: base64 HMAC-SHA256 over the signature timestamp concatenated with
 * the raw body, keyed with the client secret, in `X-WHOOP-Signature` with the
 * timestamp in `X-WHOOP-Signature-Timestamp`.
 */
function verifyWhoop(request: Request, rawBody: string): WebhookAuthResult {
  const credentials = getWearableClientCredentials("whoop");
  if (!credentials) {
    return { ok: false, status: 503, error: "WHOOP credentials not configured" };
  }
  const provided = request.headers.get("x-whoop-signature");
  const timestamp = request.headers.get("x-whoop-signature-timestamp");
  if (!provided || !timestamp) {
    return { ok: false, status: 401, error: "Missing WHOOP signature headers" };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 401, error: "Malformed WHOOP signature timestamp" };
  }
  if (Math.abs(Date.now() - timestampMs) > WHOOP_TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, status: 401, error: "WHOOP signature timestamp outside tolerance" };
  }

  const expected = createHmac("sha256", credentials.clientSecret)
    .update(timestamp + rawBody)
    .digest("base64");
  return constantTimeEquals(provided, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Bad signature" };
}

/** Oura and Garmin: unsigned, so the registered callback URL carries a
 * shared secret. Accepted from a header too, so a provider that grows real
 * signing support later can move off the query string without a URL change. */
function verifySharedSecret(
  provider: CloudOAuthWearableProvider,
  request: Request
): WebhookAuthResult {
  const envVar = SHARED_SECRET_ENV[provider];
  if (!envVar) {
    return { ok: false, status: 404, error: "Provider does not accept webhooks" };
  }
  const secret = process.env[envVar];
  if (!secret) {
    return { ok: false, status: 503, error: `${envVar} is not configured` };
  }

  const url = new URL(request.url);
  const provided = request.headers.get("x-tarragon-webhook-secret") ?? url.searchParams.get("secret");
  if (!provided) return { ok: false, status: 401, error: "Missing webhook secret" };

  return constantTimeEquals(provided, secret)
    ? { ok: true }
    : { ok: false, status: 401, error: "Bad webhook secret" };
}

/**
 * Subscription-registration handshake. Fitbit and Oura both refuse to create
 * a subscription until the endpoint answers a GET challenge correctly, so
 * without this there is literally no way to register one — this is the piece
 * that makes "drop in real credentials and it works" true rather than
 * "drop in credentials and then discover you can't complete setup".
 *
 * Returns null when the request isn't a handshake, so the caller can 404.
 */
export function handleVerificationChallenge(
  provider: CloudOAuthWearableProvider,
  request: Request
): Response | null {
  const url = new URL(request.url);

  if (provider === "fitbit") {
    const verify = url.searchParams.get("verify");
    if (verify === null) return null;
    const expected = process.env.FITBIT_WEBHOOK_VERIFICATION_CODE;
    // Fitbit's protocol is precise: 204 for the correct code, 404 for
    // anything else. It deliberately sends a wrong code as well as the right
    // one and fails the subscription if both are answered the same way.
    if (expected && constantTimeEquals(verify, expected)) {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }

  if (provider === "oura") {
    const token = url.searchParams.get("verification_token");
    const challenge = url.searchParams.get("challenge");
    if (token === null && challenge === null) return null;
    const expected = process.env.OURA_WEBHOOK_VERIFICATION_TOKEN;
    if (!expected || !token || !challenge || !constantTimeEquals(token, expected)) {
      return new Response(null, { status: 401 });
    }
    return Response.json({ challenge });
  }

  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
