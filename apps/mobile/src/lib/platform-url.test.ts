/**
 * isPlatformUrl is the WebView navigation allowlist: anything it approves is
 * rendered inside the authenticated app shell, with the session it carries.
 * A too-loose match here is a phishing surface, not a routing bug.
 */
import { isPlatformUrl, PLATFORM_HOST } from "./platform-url";

it("allows the platform's own host", () => {
  expect(isPlatformUrl(`https://${PLATFORM_HOST}/patient/vitals`)).toBe(true);
  expect(isPlatformUrl(`https://${PLATFORM_HOST}`)).toBe(true);
});

it("allows Paystack's hosted checkout, which a purchase flow redirects through", () => {
  expect(isPlatformUrl("https://checkout.paystack.com/abc123")).toBe(true);
});

it.each([
  ["a lookalike host that merely ends in the platform name", `https://evil-${PLATFORM_HOST}/login`],
  ["the platform host as a subdomain of someone else's", `https://${PLATFORM_HOST}.evil.example/login`],
  ["a suffix-match near-miss on paystack", "https://notpaystack.com/pay"],
  ["paystack's bare apex, which the allowlist does not cover", "https://paystack.com/pay"],
  ["checkout.stripe.com, dropped with the Stripe integration", "https://checkout.stripe.com/pay/abc"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["a file: URL", "file:///etc/passwd"],
  ["something that is not a URL at all", "not a url"],
  ["an empty string", ""],
])("refuses %s", (_label, url) => {
  expect(isPlatformUrl(url)).toBe(false);
});
