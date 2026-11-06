import nextConfig from "../../../next.config";
import { buildCsp } from "./csp-policy";

describe("buildCsp", () => {
  it("keeps the marketing policy exactly as before: unsafe-inline scripts, no nonce, no report-uri", () => {
    const p = buildCsp({ inAppCall: false });
    expect(p).toContain("script-src 'self' 'unsafe-inline' https://maps.googleapis.com");
    expect(p).not.toContain("nonce-");
    expect(p).not.toContain("report-uri");
  });

  it("puts the nonce and 'strict-dynamic' first on the app host, with dev-only eval", () => {
    const p = buildCsp({ inAppCall: false, nonce: "abc" });
    expect(p).toMatch(/^default-src 'self'; script-src 'nonce-abc' 'strict-dynamic' /);
    expect(p).toContain("report-uri /api/csp-report");
    expect(p).not.toContain("'unsafe-eval'");
    expect(buildCsp({ inAppCall: false, nonce: "abc", dev: true })).toContain("'unsafe-eval'");
    // style-src never takes the nonce: that would silently disable 'unsafe-inline' for React's style="" attributes.
    expect(p).toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(p).not.toMatch(/style-src[^;]*nonce/);
  });

  it("keeps the Zoom allowances on the call pages", () => {
    const p = buildCsp({ inAppCall: true, nonce: "abc" });
    expect(p).toContain("'wasm-unsafe-eval'");
    expect(p).toContain("media-src 'self' blob:");
  });
});

describe("next.config headers", () => {
  it("never sends its static CSP to the app host (a second policy shadows the nonce on Vercel)", async () => {
    const rules = await nextConfig.headers!();
    const cspRules = rules.filter((r) => r.headers.some((h) => h.key.toLowerCase() === "content-security-policy"));
    expect(cspRules.length).toBeGreaterThan(0);
    for (const r of cspRules) {
      expect(r.missing).toEqual([{ type: "host", value: "app\\..*" }]);
    }
    expect(new RegExp("^app\\..*$").test("app.tarragonhealth.ng")).toBe(true);
    expect(new RegExp("^app\\..*$").test("tarragonhealth.ng")).toBe(false);
  });
});
