import "server-only";

/**
 * Vendor-agnostic identity-verification (KYC) boundary.
 *
 * No real NIN/BVN provider is wired yet — like the wearable OAuth scaffolding,
 * this degrades gracefully: when unconfigured, verifyIdentity() returns
 * `unavailable`, the request is still recorded as `pending`, and ops (or a
 * future provider webhook) can resolve it. When a provider IS configured
 * (env IDENTITY_PROVIDER + IDENTITY_API_KEY), plug the real call into
 * callProvider() below — the never-throw `{ ok, ... }` contract stays the same.
 */

export type IdentityMethod = "nin" | "bvn";

export type VerifyIdentityResult =
  | { ok: true; verified: boolean; provider: string; reference: string | null }
  | { ok: false; reason: "unavailable" | "error" };

export function isIdentityVerificationConfigured(): boolean {
  return Boolean(process.env.IDENTITY_PROVIDER && process.env.IDENTITY_API_KEY);
}

/**
 * Attempt to verify an identity document. Never throws; the caller records a
 * pending request regardless and reflects this result if it can.
 */
export async function verifyIdentity(
  method: IdentityMethod,
  idNumber: string,
): Promise<VerifyIdentityResult> {
  if (!isIdentityVerificationConfigured()) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    // TODO: real provider integration goes here — a POST of { method, idNumber }
    // to the KYC vendor identified by IDENTITY_PROVIDER using IDENTITY_API_KEY.
    // Kept as an unavailable no-op until a vendor is contracted, so the button
    // never clicks through to nothing.
    const request = { method, idNumber, provider: process.env.IDENTITY_PROVIDER };
    void request;
    return { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
