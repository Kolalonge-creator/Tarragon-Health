import type { MessageKey } from "@tarragon/i18n";
import { authErrorKey, requestPhoneCode, sanitiseOtp, isOtpComplete, type AuthApi } from "@/lib/auth/auth-flow";

/**
 * Forgotten PIN for a private section (S66): the person proves they hold the account's own phone (or, with no phone, its email) with a
 * one-time code, and only then does the app clear the PIN record on THIS device (PrivateLockController.resetAfterReverification).
 * Nothing on the server is read or changed; no health data is lost. It reuses the S03 code flows so rate limits, error wording and the
 * "never reveal whether a number is registered" rules are the same ones the sign-in screens already have.
 */

export interface RecoveryAuth {
  getUser(): Promise<{ data: { user: { id: string; phone?: string | null; email?: string | null } | null } }>;
  signInWithOtp: AuthApi["signInWithOtp"] | ((args: { email: string; options?: { shouldCreateUser?: boolean } }) => Promise<{ error: { message: string } | null }>);
  verifyOtp(args: { phone: string; token: string; type: "sms" } | { email: string; token: string; type: "email" }): Promise<{ error: { message: string } | null }>;
}

export type RecoveryRequest = { kind: "sent"; via: "phone" | "email"; userId: string } | { kind: "error"; key: MessageKey };
export type RecoveryVerify = { kind: "verified" } | { kind: "error"; key: MessageKey };

async function contact(auth: RecoveryAuth) {
  const { data } = await auth.getUser();
  const user = data.user;
  if (!user) return null;
  if (user.phone) return { userId: user.id, kind: "phone" as const, value: `+${user.phone.replace(/^\+/, "")}` };
  if (user.email) return { userId: user.id, kind: "email" as const, value: user.email };
  return null;
}

export async function requestRecoveryCode(auth: RecoveryAuth): Promise<RecoveryRequest> {
  const c = await contact(auth).catch(() => null);
  if (!c) return { kind: "error", key: "auth.error.generic" };
  if (c.kind === "phone") {
    const r = await requestPhoneCode(auth as unknown as AuthApi, c.value);
    return r.kind === "sent" ? { kind: "sent", via: "phone", userId: c.userId } : r;
  }
  const { error } = await (auth.signInWithOtp as (a: { email: string; options?: { shouldCreateUser?: boolean } }) => Promise<{ error: { message: string } | null }>)({
    email: c.value,
    options: { shouldCreateUser: false },
  });
  return error ? { kind: "error", key: authErrorKey(error.message, "recovery") } : { kind: "sent", via: "email", userId: c.userId };
}

export async function verifyRecoveryCode(auth: RecoveryAuth, rawCode: string, expectedUserId: string): Promise<RecoveryVerify> {
  if (!isOtpComplete(rawCode)) return { kind: "error", key: "auth.error.wrong_code" };
  const token = sanitiseOtp(rawCode);
  const c = await contact(auth).catch(() => null);
  if (!c || c.userId !== expectedUserId) return { kind: "error", key: "auth.error.generic" };
  const { error } = await (c.kind === "phone"
    ? auth.verifyOtp({ phone: c.value, token, type: "sms" })
    : auth.verifyOtp({ email: c.value, token, type: "email" }));
  if (error) return { kind: "error", key: authErrorKey(error.message, "verify") };
  // The code went to this account's own contact; the signed-in user afterwards must still be this account.
  const after = await auth.getUser().catch(() => null);
  if (!after?.data.user || after.data.user.id !== expectedUserId) return { kind: "error", key: "auth.error.generic" };
  return { kind: "verified" };
}
