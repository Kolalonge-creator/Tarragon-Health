/**
 * @jest-environment jsdom
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { clearStoredConsent, isAnalyticsAllowedNow, isSignedInAppPath, setStoredConsent, SIGNED_IN_APP_PREFIXES } from "./consent";

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

describe("which pages are opt-in", () => {
  it("every public page is opt-in, including the anonymous pages outside the marketing route list", () => {
    for (const path of ["/", "/pricing", "/signup", "/login", "/forgot-password", "/checkout/abc", "/claim/x", "/share/y", "/circle/z", "/verify-report"]) {
      expect(isSignedInAppPath(path)).toBe(false);
    }
  });

  it("the signed-in app areas are opt-out, without matching look-alike prefixes", () => {
    expect(isSignedInAppPath("/patient")).toBe(true);
    expect(isSignedInAppPath("/patient/vitals")).toBe(true);
    expect(isSignedInAppPath("/onboarding")).toBe(true);
    expect(isSignedInAppPath("/patients-guide")).toBe(false);
  });

  it("lists every folder of the signed-in app route group, so a new area is not missed", () => {
    const dir = join(__dirname, "..", "app", "(dashboard)");
    const areas = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && !n.startsWith("_") && !n.startsWith("("));
    for (const area of areas) expect(SIGNED_IN_APP_PREFIXES).toContain(`/${area}`);
  });
});
