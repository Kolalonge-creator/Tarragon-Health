import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { CloudOAuthWearableProvider } from "./oauth-providers";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — just long enough for the redirect round-trip.

interface StatePayload {
  patientId: string;
  provider: CloudOAuthWearableProvider;
  issuedAt: number;
}

function signingSecret(): string {
  // No dedicated OAuth-state secret exists in this codebase's env yet;
  // SUPABASE_SERVICE_ROLE_KEY is already server-only and never sent to the
  // client, so it's a reasonable signing key for a short-lived CSRF token
  // that never leaves this process's own redirect round-trip.
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

function sign(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

/** Encodes patientId+provider+timestamp into a signed, URL-safe state
 * token — verified on callback so a forged `state` can't complete a
 * connection for someone else's account (the OAuth CSRF-protection role
 * getWearableOAuthUrl's own docstring calls out as the caller's job). */
export function createWearableOAuthState(
  patientId: string,
  provider: CloudOAuthWearableProvider
): string {
  const payload: StatePayload = { patientId, provider, issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyWearableOAuthState(
  state: string,
  expectedProvider: CloudOAuthWearableProvider
): { ok: true; patientId: string } | { ok: false; error: string } {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return { ok: false, error: "Malformed state" };

  const expectedSignature = sign(encoded);
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { ok: false, error: "Invalid state signature" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Malformed state payload" };
  }

  if (payload.provider !== expectedProvider) return { ok: false, error: "Provider mismatch" };
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) return { ok: false, error: "State expired" };

  return { ok: true, patientId: payload.patientId };
}
