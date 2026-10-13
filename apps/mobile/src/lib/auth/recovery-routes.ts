/**
 * Pure logic for the S03b recovery routes on the phone: backup code, Care Circle recovery contact, and the pause that follows
 * a recent number change (OQ-43). Free of React and of the concrete Supabase client (passed in), so every branch that matters
 * for safety is unit-tested without a device or a network.
 *
 *  - The backup-code and contact calls go to the platform's public recovery routes (apps/web/src/app/api/auth/recovery/*). The
 *    phone has no session when it calls them. The server sets the password; the phone then signs in with it.
 *  - An answer that is "no" for any reason (unknown account, wrong code, used code) is one outcome.
 *  - Nothing here logs. A code, a password, a number or an address must never reach console, Sentry, analytics or a URL.
 */
import { classifyRecoveryIdentifier, formatLagosDateTime, interpretPhoneRecoveryHold, normaliseBackupCode } from "@tarragon/auth/recovery";
import type { MessageKey } from "@tarragon/i18n";

type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

const TIMEOUT_MS = 15_000;

async function postJson(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown } | { network: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch {
    return { network: true };
  } finally {
    clearTimeout(timer);
  }
}

export type BackupCodeOutcome =
  | { kind: "ok"; signInWith: { kind: "email" | "phone"; value: string } }
  | { kind: "error"; key: MessageKey; message?: string };

export async function recoverWithBackupCodeRemote(
  args: { identifier: string; code: string; newPassword: string },
  fetchImpl: FetchLike,
  baseUrl: string,
): Promise<BackupCodeOutcome> {
  // Shape only, on the phone, so a typo is caught before a round trip. This reveals nothing about any account.
  if (!classifyRecoveryIdentifier(args.identifier).ok || !normaliseBackupCode(args.code)) {
    return { kind: "error", key: "auth.recovery.backup_failed" };
  }
  const res = await postJson(fetchImpl, baseUrl, "/api/auth/recovery/backup-code", args);
  if ("network" in res) return { kind: "error", key: "auth.error.offline" };
  const body = (res.body ?? {}) as { ok?: boolean; reason?: string; message?: string; signInWith?: { kind?: string; value?: string } };
  if (res.status === 200 && body.ok === true && body.signInWith && typeof body.signInWith.value === "string") {
    const kind = body.signInWith.kind === "phone" ? "phone" : "email";
    return { kind: "ok", signInWith: { kind, value: body.signInWith.value } };
  }
  if (res.status === 429 || body.reason === "rate_limited") return { kind: "error", key: "auth.error.rate_limited" };
  if (body.reason === "weak_password") return { kind: "error", key: "auth.error.generic", message: typeof body.message === "string" ? body.message : undefined };
  if (res.status >= 500 || body.reason === "unavailable") return { kind: "error", key: "auth.error.generic" };
  return { kind: "error", key: "auth.recovery.backup_failed" };
}

export type ContactRouteOutcome = { kind: "done" } | { kind: "error"; key: MessageKey };

export async function contactRecoveryRemote(
  action: "ask" | "send",
  identifier: string,
  fetchImpl: FetchLike,
  baseUrl: string,
): Promise<ContactRouteOutcome> {
  if (!classifyRecoveryIdentifier(identifier).ok) return { kind: "error", key: "auth.error.invalid_phone" };
  const res = await postJson(fetchImpl, baseUrl, "/api/auth/recovery/contact", { action, identifier });
  if ("network" in res) return { kind: "error", key: "auth.error.offline" };
  if (res.status === 200) return { kind: "done" };
  if (res.status === 429) return { kind: "error", key: "auth.error.rate_limited" };
  return { kind: "error", key: "auth.error.generic" };
}

/** The slice of the Supabase client the hold check uses. */
export interface HoldClient {
  rpc(fn: "my_phone_recovery_hold"): PromiseLike<{ data: unknown; error: unknown }>;
  auth: { signOut(): PromiseLike<unknown> };
}

export type HoldCheck = { kind: "clear" } | { kind: "held"; untilText: string } | { kind: "unknown" };

/**
 * Run right after a recovery code was accepted (the phone is signed in as of that code). If recovery by text code is paused
 * (OQ-43: the number changed in the last few days) or the pause cannot be read, the session is ENDED here, so the person never
 * reaches the reset-password step. Fails closed.
 */
export async function enforcePhoneRecoveryHold(client: HoldClient): Promise<HoldCheck> {
  let hold;
  try {
    const { data, error } = await client.rpc("my_phone_recovery_hold");
    hold = interpretPhoneRecoveryHold(data, error);
  } catch {
    hold = { status: "unknown" as const };
  }
  if (hold.status === "clear") return { kind: "clear" };
  try {
    await client.auth.signOut();
  } catch {
    // Signing out failed too: still refuse to continue; the caller shows the same message.
  }
  return hold.status === "held" ? { kind: "held", untilText: formatLagosDateTime(hold.until) } : { kind: "unknown" };
}
