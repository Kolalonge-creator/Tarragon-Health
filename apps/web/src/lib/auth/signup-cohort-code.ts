import "server-only";

import * as Sentry from "@sentry/nextjs";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { t, type Locale } from "@tarragon/i18n";

/**
 * The optional programme (cohort or sponsor) code on the sign-up form (S03b, spec 1.8; closes OQ-41).
 *
 * The code is CHECKED here, so a mistyped one is caught while the person is still looking at the form, and it travels with the
 * new account as a pending value in the account's own metadata. NOTHING is claimed or joined here: the database joins the
 * cohort, and claims any employer roster slot, only after the phone or email is verified
 * (supabase/migrations/*_s03b_eligibility_first_claims.sql). Kept out of the sign-up actions so they change by a few lines.
 *
 * The check is service-role only (an anonymous probe of cohort codes would be a code oracle) and rate limited per IP.
 */
export type SignupCohortCode = { ok: true; code: string | null } | { ok: false; error: string };

/** The 8 symbols a cohort code is made of; anything else typed (spaces, dashes, case) is formatting. */
export function normaliseCohortCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function readSignupCohortCode(formData: FormData, locale: Locale): Promise<SignupCohortCode> {
  const typed = String(formData.get("cohortCode") ?? "").trim();
  if (typed === "") return { ok: true, code: null };

  const invalid = { ok: false as const, error: t("auth.signup.programme_code_invalid", locale) };
  const code = normaliseCohortCode(typed);
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return invalid;

  const limited = await checkAuthRateLimit("signup-cohort-code", null, { limit: 10, windowSeconds: 900 });
  if (!limited.success) return { ok: false, error: t("auth.error.rate_limited", locale) };

  const { data, error } = await createServiceRoleClient().rpc("check_cohort_code_for_signup", { p_code: code });
  if (error) {
    Sentry.captureMessage("signup cohort code check failed", "error");
    return { ok: false, error: t("auth.error.generic", locale) };
  }
  // Unknown, expired, closed and full are one answer.
  return data === true ? { ok: true, code } : invalid;
}
