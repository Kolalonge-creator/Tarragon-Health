export const PLATFORM_URL =
  process.env.EXPO_PUBLIC_PLATFORM_URL ?? "https://tarragon-health-web.vercel.app";

export const PLATFORM_HOST = new URL(PLATFORM_URL).host;

/** Allowlist for WebView navigation: the platform itself, plus Paystack's
 * hosted checkout pages a voucher/service-purchase flow redirects through
 * and back. Anything else opens in the system browser instead of hijacking
 * the shell. checkout.stripe.com dropped 2026-09-03 with the rest of the
 * Stripe integration — no checkout can ever redirect there any more. */
export function isPlatformUrl(url: string): boolean {
  try {
    const { host, protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return host === PLATFORM_HOST || host.endsWith(".paystack.com");
  } catch {
    return false;
  }
}
