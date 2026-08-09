export const PLATFORM_URL =
  process.env.EXPO_PUBLIC_PLATFORM_URL ?? "https://tarragon-health-web.vercel.app";

export const PLATFORM_HOST = new URL(PLATFORM_URL).host;

/** Allowlist for WebView navigation: the platform itself, plus the hosted
 * checkout pages the subscription flow redirects through and back. Anything
 * else opens in the system browser instead of hijacking the shell. */
export function isPlatformUrl(url: string): boolean {
  try {
    const { host, protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return host === PLATFORM_HOST || host.endsWith(".paystack.com") || host === "checkout.stripe.com";
  } catch {
    return false;
  }
}
