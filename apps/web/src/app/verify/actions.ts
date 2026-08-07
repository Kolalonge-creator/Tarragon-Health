"use server";

import { verifyPassportBySerial, type PassportVerification } from "@/lib/health-passport/verify";

/**
 * The identity challenge, run server-side.
 *
 * A server action rather than a query string, deliberately: a date of birth in a
 * URL would end up in browser history, in any proxy log between the verifier and
 * us, and in the Referer of anything the page later links to. It is exactly the
 * kind of value that must never travel in a URL.
 *
 * Throttling lives in the RPC (twenty attempts an hour per passport), not here,
 * so it cannot be sidestepped by calling the function another way.
 */
export async function confirmPassportIdentity(
  _previous: PassportVerification | null,
  formData: FormData
): Promise<PassportVerification | null> {
  const serial = String(formData.get("serial") ?? "");
  const dob = String(formData.get("dob") ?? "").trim();
  if (!serial || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  return verifyPassportBySerial(serial, dob);
}
