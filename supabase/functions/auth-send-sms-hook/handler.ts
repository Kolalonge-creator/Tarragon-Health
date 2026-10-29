// Supabase Auth "Send SMS" hook (v5 S03, spec sections 8.2 and 10; INV-08, OQ-21).
//
// Supabase Auth calls this instead of its built-in SMS provider whenever it needs to deliver a phone one-time code.
// What this does, in order, and refuses at the first failure:
//   1. Verifies the Standard Webhooks signature (HMAC-SHA256, constant-time compare, 5 minute tolerance) BEFORE
//      reading anything from the body. An unsigned or stale call gets 401 and touches nothing.
//   2. OQ-43 / OQ-S03B-06: WITHHOLDS the code (silently, with the same 200 as a normal send) when the account's sign-in number
//      moved inside the recovery pause (public.auth_sms_hold) and this is not the code for a pending number change. This is the
//      only place a text code is checked at the Auth level, so it covers a direct call to the Auth API. Fails closed (503).
//   3. Enforces a PHONE-keyed limit from sms_delivery_log (max sends per hour), so rotating IP addresses cannot
//      bypass it. If the log cannot be read, it refuses (503): an unbounded SMS sender is the worse failure.
//   4. Sends through the SmsProvider interface (mock by default), one retry for a retryable failure.
//   5. Records the outcome. The phone is stored only as an HMAC, the code never.
// Nothing here logs a phone number or a code. Errors returned to Auth carry no phone or code either.

import type { SmsProvider } from "./provider.ts";
import { buildOtpText } from "./provider.ts";

export const MAX_SENDS_PER_HOUR = 5; // spec 8.2; mirrored in packages/shared proposed-config "auth.phone_otp".
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface SmsOutcome {
  status: "sent" | "failed";
  attempts: number;
  providerMessageId?: string;
  errorCode?: string;
}

export interface SmsLogStore {
  /**
   * Atomically takes one of the phone's hourly slots (sms_delivery_log via reserve_auth_sms_slot). Resolves to the
   * reservation id, or null when the phone is over its cap (the refusal is recorded by the database). Throws if the
   * database cannot be reached, which the handler treats as "refuse", never "allow".
   */
  reserve(phoneHash: string, userId: string | null, provider: string): Promise<string | null>;
  /** Records how the send ended. A failed send gives its slot back. */
  finish(reservationId: string, outcome: SmsOutcome): Promise<void>;
}

export interface HoldStore {
  /**
   * Is the account inside the recovery pause (its sign-in number was replaced recently and no recovery contact has released it)?
   * Throws if the database cannot be read, which the handler treats as "refuse", never "allow".
   */
  isHeld(userId: string): Promise<boolean>;
}

export interface HookDeps {
  secret: string; // SEND_SMS_HOOK_SECRET, "v1,whsec_<base64>" as Supabase issues it
  pepper: string; // SMS_LOG_PEPPER, keys the phone hash
  provider: SmsProvider;
  store: SmsLogStore;
  holds: HoldStore;
  nowSeconds?: () => number;
}

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time string compare (length difference still short-circuits, which leaks only length). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const rawSecret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64ToBytes(rawSecret);
  } catch {
    return false;
  }
  const expected = bytesToB64(await hmac(keyBytes, `${id}.${timestamp}.${rawBody}`));
  // The header may carry several space-separated "v1,<sig>" entries (key rotation).
  return signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => timingSafeEqual(sig, expected));
}

export async function phoneHash(phone: string, pepper: string): Promise<string> {
  return toHex(await hmac(enc.encode(pepper), phone));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Auth reads `error.http_code` and `error.message`; the message is shown to no end user and carries nothing sensitive. */
function hookError(httpCode: number, message: string): Response {
  return json(httpCode, { error: { http_code: httpCode, message } });
}

/** The slice of Auth's user object the hook reads to tell a number-change code from every other code. */
export interface HookUser {
  id?: string;
  phone?: string;
  phone_change?: string;
  /** GoTrue serialises the pending number as `new_phone`; both spellings are read. */
  new_phone?: string;
  phone_change_sent_at?: string;
  confirmation_sent_at?: string;
  recovery_sent_at?: string;
  reauthentication_sent_at?: string;
}

const PHONE_CHANGE_FRESH_SECONDS = 120;

/**
 * True only when we are SURE this code is the one for a pending number change (the code to the NEW number, which must still go
 * out during the pause). Auth sends a sign-in code and a recovery code the same way, so they cannot be told apart; a number-change
 * code is the one whose own timestamp is the newest of all the code timestamps and is seconds old. Anything unclear is treated as
 * NOT a number-change code, because the mistake that fails closed (withholding a code) is the safe one.
 */
function pendingNumber(user: HookUser): string {
  return user.new_phone || user.phone_change || "";
}

export function isPhoneChangeCode(user: HookUser, nowSeconds: number): boolean {
  if (!pendingNumber(user) || !user.phone_change_sent_at) return false;
  const own = Date.parse(user.phone_change_sent_at) / 1000;
  if (!Number.isFinite(own) || Math.abs(nowSeconds - own) > PHONE_CHANGE_FRESH_SECONDS) return false;
  for (const other of [user.confirmation_sent_at, user.recovery_sent_at, user.reauthentication_sent_at]) {
    if (other === undefined || other === null || other === "") continue;
    const t = Date.parse(other) / 1000;
    if (!Number.isFinite(t)) return false; // an unreadable timestamp: cannot be sure
    if (t >= own) return false;
  }
  return true;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export async function handleHookRequest(req: Request, deps: HookDeps): Promise<Response> {
  if (req.method !== "POST") return hookError(405, "method_not_allowed");
  // Fail closed: a hook with no secret or pepper must never accept a call or send a message.
  if (!deps.secret || !deps.pepper) return hookError(503, "not_configured");
  const now = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const raw = await req.text();

  // 1. Authenticate the caller before parsing anything.
  if (!(await verifyStandardWebhook(raw, req.headers, deps.secret, now))) {
    return hookError(401, "invalid_signature");
  }

  let payload: { user?: HookUser; sms?: { otp?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return hookError(400, "invalid_body");
  }
  const otp = payload.sms?.otp;
  if (!otp || !/^\d{4,10}$/.test(otp)) return hookError(400, "invalid_payload");
  // A first-time number add arrives with no current phone and the number in the pending field, so either may carry the destination.
  const asE164 = (n: string | undefined): string | null => {
    if (!n) return null;
    const e = n.startsWith("+") ? n : `+${n}`;
    return E164.test(e) ? e : null;
  };
  const current = asE164(payload.user?.phone);
  const pendingTo = asE164(payload.user ? pendingNumber(payload.user) : undefined);
  const changeCode = isPhoneChangeCode(payload.user ?? {}, now);
  // An account with NO current phone can only be asking for a code to the pending number (a sign-in or reauthentication code needs a
  // phone on the account). Auth stamps phone_change_sent_at only after the hook answers, so on a first-time add the stamp is missing
  // and changeCode is false: without this fallback the hook answered 400 and the first number could never be added.
  const to = changeCode && pendingTo ? pendingTo : current ?? pendingTo;
  if (!to) return hookError(400, "invalid_payload");
  const userId = payload.user?.id ?? null;

  // 2. The recovery pause (OQ-43). The code for a pending number change is the one thing that must still go out, and it goes to the
  // NEW number. Everything else for a paused account is withheld below, AFTER the same hourly slot is taken as for a real send, so a
  // paused and an unpaused account see the same 200 and the same 429 once the cap is reached (no enumeration signal), and a row
  // is left in sms_delivery_log (error_code 'withheld_pause') so support can tell a withheld code from a lost one. A missing user
  // id cannot be checked, so it is refused (fail closed).
  if (!userId) return hookError(400, "invalid_payload");
  let withhold = false;
  if (!changeCode) {
    try {
      withhold = await deps.holds.isHeld(userId);
    } catch {
      return hookError(503, "temporarily_unavailable");
    }
  }

  const hash = await phoneHash(to, deps.pepper);

  // 3. Phone-keyed rate limit, taken atomically BEFORE sending. Fail closed if the database is unreachable.
  let reservation: string | null;
  try {
    reservation = await deps.store.reserve(hash, userId, deps.provider.name);
  } catch {
    return hookError(503, "temporarily_unavailable");
  }
  if (reservation === null) return hookError(429, "too_many_requests");

  if (withhold) {
    try {
      await deps.store.finish(reservation, { status: "sent", attempts: 1, errorCode: "withheld_pause" });
    } catch {
      console.error("auth-send-sms-hook: could not record a withheld code");
    }
    console.warn("auth-send-sms-hook: a code was withheld (recovery pause)");
    return json(200, {});
  }

  // 4. Send, with one retry when the provider says the failure is transient.
  const text = buildOtpText(otp);
  let attempts = 1;
  let result = await deps.provider.send({ to, text });
  if (!result.ok && result.retryable) {
    attempts = 2;
    result = await deps.provider.send({ to, text });
  }

  // 5. Record the outcome (never the code, never the number). If this write fails the row stays 'reserved', which still
  // counts toward the cap, so a broken log can only make the limit stricter, never looser. The failure is reported
  // without any identifying detail so it is not silent.
  try {
    await deps.store.finish(
      reservation,
      result.ok
        ? { status: "sent", attempts, providerMessageId: result.providerMessageId }
        : { status: "failed", attempts, errorCode: result.code },
    );
  } catch {
    console.error("auth-send-sms-hook: could not record the send outcome");
  }

  if (!result.ok) return hookError(502, "delivery_failed");
  return json(200, {});
}
