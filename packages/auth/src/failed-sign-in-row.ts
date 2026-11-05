import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/** Which sign-in form failed. Stored on the audit row so a spike can be traced to one path. */
// apps/console is not wired: it deliberately holds no service-role key (apps/console/.env.example), and an anonymous RPC would
// let anyone forge failures. Staff sign in on apps/web today (only /ngo has moved), which is recorded.
export type FailedSignInMethod = "email_password" | "phone_password" | "phone_code";

export type FailedSignInRow = {
  action: "auth.sign_in_failed";
  entity_type: "auth_identifier";
  event: { identifier_hash: string; method: FailedSignInMethod };
  ip: string | null;
  result: "failed";
};

/**
 * Builds the audit_log row for one failed sign-in (security audit 2026-11-05, H-7). The email or phone is never stored: it is
 * normalised (trimmed, lower-cased) and keyed-hashed, so the same account's failures group together for the
 * failed_sign_in_spike alert while the log itself cannot be read back to an address. An IP that is not a real address
 * ("unknown" when no proxy header was present) is stored as null, because audit_log.ip is inet.
 */
export function failedSignInRow(identifier: string, method: FailedSignInMethod, ip: string, hashKey: string): FailedSignInRow {
  const identifierHash = createHmac("sha256", hashKey).update(identifier.trim().toLowerCase()).digest("hex");
  return {
    action: "auth.sign_in_failed",
    entity_type: "auth_identifier",
    event: { identifier_hash: identifierHash, method },
    ip: isIP(ip) ? ip : null,
    result: "failed",
  };
}
