/**
 * Server-only Twilio Proxy client. Never import this from a "use client"
 * file — it holds TWILIO_AUTH_TOKEN.
 *
 * Twilio Proxy masks a call between two real phone numbers behind a
 * Session: each Participant added to the Session gets a `proxy_identifier`
 * (a masked number from the Proxy Service's number pool) issued by Twilio.
 * Either participant dials their OWN proxy_identifier from their own phone
 * and Twilio automatically bridges to the other Session participant — this
 * is Twilio Proxy's built-in Session/Interaction behaviour, no separate
 * Voice TwiML app is needed for basic bridging. Real phone numbers are
 * never returned by this client to its caller beyond what was passed in —
 * only the masked proxy_identifier comes back out.
 *
 * Same never-throw contract as lib/zoom/client.ts / lib/paystack/client.ts:
 * any network error, timeout, non-2xx, or malformed response resolves to
 * `{ ok: false, error }` rather than throwing.
 */

const TWILIO_API_BASE_URL = "https://proxy.twilio.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export type TwilioProxyResult<T> = { ok: true; data: T } | { ok: false; error: string };

function getCredentials(): { accountSid: string; authToken: string; proxyServiceSid: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const proxyServiceSid = process.env.TWILIO_PROXY_SERVICE_SID;
  if (!accountSid || !authToken || !proxyServiceSid) return null;
  return { accountSid, authToken, proxyServiceSid };
}

/** True once all three Twilio Proxy credentials are configured — callers use this to decide whether to offer masked calling at all. */
export function isTwilioProxyConfigured(): boolean {
  return getCredentials() !== null;
}

async function twilioProxyFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "DELETE"; form?: Record<string, string> }
): Promise<TwilioProxyResult<T>> {
  const credentials = getCredentials();
  if (!credentials) {
    return { ok: false, error: "Twilio Proxy credentials are not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64");
    const response = await fetch(`${TWILIO_API_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: controller.signal,
    });

    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }

    const json = (await response.json().catch(() => null)) as T | { message?: string } | null;

    if (!response.ok) {
      const message = json && typeof json === "object" && "message" in json ? json.message : undefined;
      return { ok: false, error: message ?? `Twilio Proxy request failed with status ${response.status}` };
    }

    return { ok: true, data: json as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown Twilio Proxy request failure" };
  } finally {
    clearTimeout(timer);
  }
}

interface TwilioProxySessionResponse {
  sid: string;
  status: string;
}

interface TwilioProxyParticipantResponse {
  sid: string;
  proxy_identifier: string | null;
  identifier: string;
}

export interface CreatedProxySession {
  proxyServiceSid: string;
  sessionSid: string;
}

export interface AddedProxyParticipant {
  participantSid: string;
  /** The masked number this participant dials to reach the other party. Null until Twilio finishes provisioning it. */
  proxyIdentifier: string | null;
}

/** Creates a new Proxy Session (uniqueName lets a lookup by our own session id, useful for the status webhook once it exists). */
export async function createProxySession(uniqueName: string): Promise<TwilioProxyResult<CreatedProxySession>> {
  const credentials = getCredentials();
  if (!credentials) {
    return { ok: false, error: "Twilio Proxy credentials are not configured" };
  }
  const result = await twilioProxyFetch<TwilioProxySessionResponse>(
    `/Services/${credentials.proxyServiceSid}/Sessions`,
    { method: "POST", form: { unique_name: uniqueName } }
  );
  if (!result.ok) return result;
  return { ok: true, data: { proxyServiceSid: credentials.proxyServiceSid, sessionSid: result.data.sid } };
}

/** Adds one real phone number to a Session as a Participant — Twilio assigns it a masked proxy_identifier. */
export async function addProxyParticipant(
  sessionSid: string,
  realPhoneE164: string,
  friendlyName: string
): Promise<TwilioProxyResult<AddedProxyParticipant>> {
  const credentials = getCredentials();
  if (!credentials) {
    return { ok: false, error: "Twilio Proxy credentials are not configured" };
  }
  const result = await twilioProxyFetch<TwilioProxyParticipantResponse>(
    `/Services/${credentials.proxyServiceSid}/Sessions/${sessionSid}/Participants`,
    { method: "POST", form: { identifier: realPhoneE164, friendly_name: friendlyName } }
  );
  if (!result.ok) return result;
  return { ok: true, data: { participantSid: result.data.sid, proxyIdentifier: result.data.proxy_identifier } };
}

/** Closes a Session — releases both participants' masked numbers back to the pool. Idempotent: closing an already-closed session is not an error worth surfacing. */
export async function closeProxySession(sessionSid: string): Promise<TwilioProxyResult<void>> {
  const credentials = getCredentials();
  if (!credentials) {
    return { ok: false, error: "Twilio Proxy credentials are not configured" };
  }
  const result = await twilioProxyFetch<TwilioProxySessionResponse>(
    `/Services/${credentials.proxyServiceSid}/Sessions/${sessionSid}`,
    { method: "POST", form: { status: "closed" } }
  );
  if (!result.ok) return result;
  return { ok: true, data: undefined };
}
