/**
 * Paystack's own error text is written for a developer wiring up the API,
 * not for a patient — e.g. `"email" must be a valid email`. Every one-off
 * checkout initiator in apps/web/src/lib/billing/ used to return that raw
 * string straight to the UI (`{ ok: false, error: result.error }`), so any
 * Paystack-side rejection — a malformed account email, a transient API
 * error, a misconfigured account setting — surfaced verbatim to whoever was
 * trying to pay. Found via the platform-credit top-up flow (QA's
 * `@tarragon.test` fixture emails trip Paystack's validator), but the same
 * unsanitised-passthrough shape existed in every other checkout path too
 * (service purchase, booking, subsidy, screening day, voucher, sponsored
 * subscription) — this is the one place all of them now funnel a failed
 * `initializeOneOffTransaction`/`initializeTransaction` call through, so a
 * patient never sees a provider's internal wording, while the real error is
 * still logged server-side for whoever has to diagnose it.
 */
export function toPatientFacingCheckoutError(providerError: string): string {
  console.error("[paystack] checkout initialization failed:", providerError);

  if (/email/i.test(providerError)) {
    return "We couldn't start checkout because of a problem with the email on your account. Please contact support so we can fix this for you.";
  }

  return "We couldn't start your card payment right now. Please try again in a moment, or contact support if this keeps happening.";
}
