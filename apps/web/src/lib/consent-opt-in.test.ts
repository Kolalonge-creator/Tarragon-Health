/**
 * @jest-environment jsdom
 */
import { clearStoredConsent, isAnalyticsAllowedNow, setStoredConsent } from "./consent";

/**
 * Founder decision W-07 (2026-11-05): analytics on the public marketing site
 * is opt-in (nothing until "Accept"); in the signed-in app it stays opt-out
 * (disclosed in the Terms, stops only on an explicit "No, thanks").
 */
describe("analytics consent models", () => {
  afterEach(() => clearStoredConsent());

  it("marketing (opt-in): no answer means no analytics", () => {
    expect(isAnalyticsAllowedNow(true)).toBe(false);
  });

  it("marketing (opt-in): only an explicit accept allows analytics", () => {
    setStoredConsent("rejected");
    expect(isAnalyticsAllowedNow(true)).toBe(false);
    setStoredConsent("accepted");
    expect(isAnalyticsAllowedNow(true)).toBe(true);
  });

  it("app (opt-out): runs unless explicitly rejected", () => {
    expect(isAnalyticsAllowedNow(false)).toBe(true);
    setStoredConsent("accepted");
    expect(isAnalyticsAllowedNow(false)).toBe(true);
    setStoredConsent("rejected");
    expect(isAnalyticsAllowedNow(false)).toBe(false);
  });
});
