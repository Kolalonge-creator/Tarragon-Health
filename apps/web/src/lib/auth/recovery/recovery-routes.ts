import "server-only";

import * as Sentry from "@sentry/nextjs";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkNewPassword } from "@/lib/auth/check-new-password";
import { classifyRecoveryIdentifier, normaliseBackupCode } from "@tarragon/auth/recovery";

/**
 * The two recovery routes that work with no signed-in session and no working phone (S03b-b): a backup code, and a Care Circle
 * recovery contact. Shared by the web server actions and the mobile API routes so both enforce exactly the same rules.
 *
 * Rules every function here keeps:
 *  - Enumeration-safe. A wrong identifier, a wrong code, a used code, an account with no contact, a contact that has not
 *    confirmed and a wait that is not over all return the same shape. Only input that cannot be a real email, number or code
 *    (a typo that never reaches the database) is told apart, because that reveals nothing about any account.
 *  - Rate limited with the existing @tarragon/auth limiter, keyed on the IP and on the identifier.
 *  - Nothing secret is logged or reported: no code, password, number or address reaches Sentry; only which step failed.
 *  - SMS stays code-only (INV-08): the only text that can result is a verification code sent by Auth through the send-SMS hook.
 */

export type BackupCodeRecoveryResult =
  | { ok: true; signInWith: { kind: "email" | "phone"; value: string } }
  | { ok: false; reason: "invalid" | "weak_password" | "rate_limited" | "unavailable"; message?: string };

/** What a person typed, checked for shape only. Never reveals whether an account exists. */
export function parseBackupCodeInput(identifier: string, code: string) {
  const id = classifyRecoveryIdentifier(identifier);
  const body = normaliseBackupCode(code);
  return id.ok && body ? { id, body } : null;
}

export async function recoverWithBackupCode(input: {
  identifier: string;
  code: string;
  newPassword: string;
}): Promise<BackupCodeRecoveryResult> {
  const parsed = parseBackupCodeInput(input.identifier, input.code);
  if (!parsed) return { ok: false, reason: "invalid" };
  const { id, body } = parsed;

  // The new password is judged before the code is touched, so a weak password never spends a code.
  const verdict = await checkNewPassword(input.newPassword);
  if (!verdict.ok) return { ok: false, reason: "weak_password", message: verdict.message };

  const limited = await checkAuthRateLimit(
    "backup-code",
    id.value,
    { limit: 20, windowSeconds: 900 },
    { limit: 6, windowSeconds: 900 },
  );
  if (!limited.success) return { ok: false, reason: "rate_limited" };

  const svc = createServiceRoleClient();
  const redeemed = await svc.rpc("redeem_backup_code", { p_kind: id.kind, p_identifier: id.value, p_code: body });
  if (redeemed.error) {
    Sentry.captureMessage("backup code recovery: redeem failed", "error");
    return { ok: false, reason: "unavailable" };
  }
  const result = redeemed.data as { ok?: boolean; user_id?: string } | null;
  if (!result?.ok || !result.user_id) return { ok: false, reason: "invalid" };
  const userId = result.user_id;

  const updated = await svc.auth.admin.updateUserById(userId, { password: input.newPassword });
  if (updated.error) {
    // The code was spent but the password did not change: give the code back so the person is not left worse off.
    const released = await svc.rpc("release_backup_code", { p_user: userId, p_code: body });
    Sentry.captureMessage(
      released.error ? "backup code recovery: password update and code release both failed" : "backup code recovery: password update failed",
      "error",
    );
    return { ok: false, reason: "unavailable" };
  }

  // Ends every other session and tells the owner. The password has already changed, so a failure here is reported, not fatal.
  const completed = await svc.rpc("complete_backup_code_recovery", { p_user: userId });
  if (completed.error || (completed.data as { ok?: boolean } | null)?.ok !== true) {
    Sentry.captureMessage("backup code recovery: sessions or notice not completed", "error");
  }
  return { ok: true, signInWith: { kind: id.kind, value: id.value } };
}

export type ContactRecoveryResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input" | "rate_limited" | "unavailable" };

/** Step 1: ask the named recovery contact. Always answers {ok:true} for a well-formed identifier. */
export async function askRecoveryContact(identifier: string): Promise<ContactRecoveryResult> {
  const id = classifyRecoveryIdentifier(identifier);
  if (!id.ok) return { ok: false, reason: "invalid_input" };
  const limited = await checkAuthRateLimit(
    "contact-recovery-ask",
    id.value,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 },
  );
  if (!limited.success) return { ok: false, reason: "rate_limited" };

  const svc = createServiceRoleClient();
  const { error } = await svc.rpc("request_contact_recovery", { p_kind: id.kind, p_identifier: id.value });
  if (error) {
    Sentry.captureMessage("contact recovery: request failed", "error");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

export interface RecoveryLinkSender {
  /** Sends Auth's standard one-time recovery email to the address on file. */
  email(address: string): Promise<{ error: unknown }>;
  /** Sends a verification code to the verified phone through the send-SMS hook (Auth itself calls the hook). */
  phoneCode(phone: string): Promise<{ error: unknown }>;
}

/**
 * Step 2: after the contact confirmed and the wait is over, send the ONE-TIME link to the patient's OWN verified email, or a
 * verification code to their OWN verified phone. Never to the contact, and no address or number is returned to the caller.
 */
export async function sendContactRecoveryLink(identifier: string, sender: RecoveryLinkSender): Promise<ContactRecoveryResult> {
  const id = classifyRecoveryIdentifier(identifier);
  if (!id.ok) return { ok: false, reason: "invalid_input" };
  const limited = await checkAuthRateLimit(
    "contact-recovery-send",
    id.value,
    { limit: 10, windowSeconds: 3600 },
    { limit: 4, windowSeconds: 3600 },
  );
  if (!limited.success) return { ok: false, reason: "rate_limited" };

  const svc = createServiceRoleClient();
  const claimed = await svc.rpc("claim_contact_recovery", { p_kind: id.kind, p_identifier: id.value });
  if (claimed.error) {
    Sentry.captureMessage("contact recovery: claim failed", "error");
    return { ok: false, reason: "unavailable" };
  }
  const claim = claimed.data as { ok?: boolean; user_id?: string; request_id?: string } | null;
  // Nothing to send (no contact, not confirmed, wait not over, already used): the caller is told exactly what it is told when it worked.
  if (!claim?.ok || !claim.user_id || !claim.request_id) return { ok: true };

  const reopen = async (why: string) => {
    const back = await svc.rpc("unrelease_contact_recovery", { p_request: claim.request_id as string });
    Sentry.captureMessage(`contact recovery: ${why}${back.error ? " (and could not reopen)" : ""}`, "error");
  };

  const found = await svc.auth.admin.getUserById(claim.user_id);
  const user = found.data?.user;
  if (found.error || !user) {
    await reopen("could not read the account");
    return { ok: false, reason: "unavailable" };
  }
  // The address and number come from Auth, never from the request, and only a VERIFIED one is used.
  let sent: { error: unknown } | null = null;
  if (user.email && user.email_confirmed_at) {
    sent = await sender.email(user.email);
  } else if (user.phone && user.phone_confirmed_at) {
    sent = await sender.phoneCode(user.phone.startsWith("+") ? user.phone : `+${user.phone}`);
  }
  if (!sent || sent.error) {
    await reopen(sent ? "send failed" : "no verified channel");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}
