import * as Crypto from "expo-crypto";
import { checkPasswordAcceptable, type PasswordVerdict } from "@tarragon/auth/password-check";
import type { MessageKey } from "@tarragon/i18n";

/**
 * React Native has no crypto.subtle, so the SHA-1 for the breached-password
 * range check comes from expo-crypto (already a dependency). Only the first
 * five hex characters of the hash ever leave the device (k-anonymity).
 */
export async function sha1HexUpper(input: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, input);
  return hex.toUpperCase();
}

export type NewPasswordCheck =
  | { ok: true }
  | { ok: false; key: MessageKey };

/** Judge a NEW password (sign-up, reset): length first, then breached. */
export async function checkNewPassword(
  password: string,
  verdictFn: (p: string, o: { sha1Hex: typeof sha1HexUpper }) => Promise<PasswordVerdict> = checkPasswordAcceptable,
): Promise<NewPasswordCheck> {
  const verdict = await verdictFn(password, { sha1Hex: sha1HexUpper });
  if (verdict.ok) return { ok: true };
  return {
    ok: false,
    key: verdict.reason === "breached" ? "auth.password.breached" : "auth.password.rule",
  };
}
