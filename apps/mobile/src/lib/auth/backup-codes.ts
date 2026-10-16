/**
 * Pure logic for backup codes on the phone (S03b follow-up, OQ-S03B-04). The phone is only a front end: the password check, the
 * single-use step-up, the daily limit and the ten-code generation all happen on the server (apps/web/src/app/api/mobile/backup-codes)
 * through the same functions the web card uses. Nothing here makes, stores or remembers a code.
 *
 *  - The codes are returned once, held in screen state only, and never written to storage, logs, analytics or a URL.
 *  - The password goes in the POST body over HTTPS, never in a URL, and is never logged.
 */
import type { MessageKey } from "@tarragon/i18n";

type FetchLike = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const TIMEOUT_MS = 15_000;
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

async function call(
  fetchImpl: FetchLike,
  baseUrl: string,
  token: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ status: number; body: unknown } | { network: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}/api/mobile/backup-codes`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
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

export interface BackupCodeStatus {
  total: number;
  remaining: number;
  generatedAt: string | null;
}

export type StatusOutcome = { kind: "ok"; status: BackupCodeStatus } | { kind: "error"; key: MessageKey };

export async function fetchBackupCodeStatus(token: string | null, fetchImpl: FetchLike, baseUrl: string): Promise<StatusOutcome> {
  if (!token) return { kind: "error", key: "auth.error.generic" };
  const res = await call(fetchImpl, baseUrl, token, "GET");
  if ("network" in res) return { kind: "error", key: "auth.error.offline" };
  const b = (res.body ?? {}) as { total?: unknown; remaining?: unknown; generatedAt?: unknown };
  if (res.status === 200 && typeof b.total === "number" && typeof b.remaining === "number") {
    return {
      kind: "ok",
      status: { total: b.total, remaining: b.remaining, generatedAt: typeof b.generatedAt === "string" ? b.generatedAt : null },
    };
  }
  return { kind: "error", key: "auth.error.generic" };
}

export type GenerateOutcome = { kind: "ok"; codes: string[] } | { kind: "error"; key: MessageKey };

/**
 * Asks the server for a new set. `confirmed` is the screen's confirmation step (regenerating ends the old set): without it nothing
 * is sent. A password is required locally too, so an empty field never costs a round trip.
 */
export async function generateBackupCodesRemote(
  args: { token: string | null; password: string; confirmed: boolean },
  fetchImpl: FetchLike,
  baseUrl: string,
): Promise<GenerateOutcome> {
  if (!args.confirmed || !args.password) return { kind: "error", key: "account.backup_codes.error_password" };
  // No session is not a wrong password: the person must sign in again, and no password attempt is spent.
  if (!args.token) return { kind: "error", key: "account.backup_codes.error_session" };
  const res = await call(fetchImpl, baseUrl, args.token, "POST", { password: args.password });
  // The server may have made the new set and ended the old one before the answer was lost, so a lost answer is never "nothing changed".
  if ("network" in res) return { kind: "error", key: "account.backup_codes.error_unsure" };
  const b = (res.body ?? {}) as { ok?: unknown; codes?: unknown; reason?: unknown };
  if (res.status === 200 && b.ok === true && Array.isArray(b.codes)) {
    const codes = b.codes.filter((c): c is string => typeof c === "string" && CODE_SHAPE.test(c));
    // A set that does not look like ten real codes is not shown as if it were one.
    if (codes.length === b.codes.length && codes.length > 0) return { kind: "ok", codes };
    return { kind: "error", key: "account.backup_codes.error_unsure" };
  }
  if (res.status === 200 && b.ok === true) return { kind: "error", key: "account.backup_codes.error_unsure" };
  if (res.status === 401) return { kind: "error", key: "account.backup_codes.error_session" };
  if (b.reason === "wrong_password" || b.reason === "no_password_route") {
    return { kind: "error", key: b.reason === "wrong_password" ? "account.backup_codes.error_password" : "account.backup_codes.error_no_route" };
  }
  if (b.reason === "daily_limit") return { kind: "error", key: "account.backup_codes.error_daily_limit" };
  if (res.status === 429 || b.reason === "rate_limited") return { kind: "error", key: "auth.error.rate_limited" };
  // Only a failure AFTER the password check (the server says so) may follow a made set; anything earlier changed nothing.
  if (b.reason === "generation_failed") return { kind: "error", key: "account.backup_codes.error_unsure" };
  return { kind: "error", key: "auth.error.generic" };
}

/** Plain text for the share sheet. Contains the codes and a one-line reminder, nothing that names the person or the account. */
export function backupCodesShareText(codes: readonly string[]): string {
  return `Tarragon Health backup codes. Each works once.\n${codes.join("\n")}`;
}

/** The "make a new set soon" nudge threshold, shown with the remaining count. */
export function backupCodesRunningLow(status: BackupCodeStatus): boolean {
  return status.total > 0 && status.remaining <= 2;
}
