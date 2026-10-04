"use server";

import { cookies } from "next/headers";
import { asLocale } from "@tarragon/i18n";
import { AUTH_LOCALE_COOKIE } from "@/lib/auth/auth-locale";

/** Stores the chosen interface language for the signed-out auth pages. Unknown values fall back to English. */
export async function setAuthLocale(value: string): Promise<void> {
  (await cookies()).set(AUTH_LOCALE_COOKIE, asLocale(value), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
