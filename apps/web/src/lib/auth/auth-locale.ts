import { cookies } from "next/headers";
import { asLocale, type Locale } from "@tarragon/i18n";

/**
 * Interface language for the signed-out auth pages (S03). Chosen on the first screen, kept in this cookie, and
 * copied to `profiles.language` once there is an account to write it to. Not a secret and carries no identity, so it
 * is a plain, long-lived, non-httpOnly-irrelevant preference cookie.
 */
export const AUTH_LOCALE_COOKIE = "tarragon_lang";

export async function getAuthLocale(): Promise<Locale> {
  try {
    return asLocale((await cookies()).get(AUTH_LOCALE_COOKIE)?.value);
  } catch {
    // Outside a request (a test, a static render): English, the platform default.
    return "en";
  }
}
