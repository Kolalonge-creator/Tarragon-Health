import { buildNonceCsp, isConsultationCallPath, sanitiseBlockedUri, sanitiseReportPath, summariseCspReports } from "./csp-nonce";

describe("csp-nonce", () => {
  it("builds a strict script policy with dev-only eval", () => {
    expect(buildNonceCsp("abc", { inAppCall: false, dev: false })).toBe(
      "script-src 'nonce-abc' 'strict-dynamic' 'self' https:; object-src 'none'; base-uri 'self'; report-uri /api/csp-report",
    );
    expect(buildNonceCsp("abc", { inAppCall: false, dev: true })).toContain("'unsafe-eval'");
  });

  it("matches the same call routes next.config gives the consultation policy", () => {
    expect(isConsultationCallPath("/clinician/consultation/e1")).toBe(true);
    expect(isConsultationCallPath("/patient/supporting/consultation/e1")).toBe(true);
    expect(isConsultationCallPath("/patient/consultations")).toBe(false);
    expect(isConsultationCallPath("/patient/consultation/e1/notes")).toBe(false);
  });

  it("never logs a query string or an id", () => {
    expect(sanitiseReportPath("https://app.tarragonhealth.ng/patient/records/0b7e2f7a-1111-4a4a-9999-123456789abc?token=secret")).toBe(
      "/patient/records/:id",
    );
    expect(sanitiseReportPath("https://app.tarragonhealth.ng/share/" + "a".repeat(64))).toBe("/share/:id");
    expect(sanitiseReportPath("not a url")).toBeNull();
    expect(sanitiseBlockedUri("https://evil.example/x.js?q=1")).toBe("https://evil.example");
    expect(sanitiseBlockedUri("inline")).toBe("inline");
  });

  it("reads both report formats", () => {
    const legacy = summariseCspReports({
      "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "inline", "document-uri": "https://app.x/login?e=1", disposition: "report" },
    });
    expect(legacy).toEqual([{ directive: "script-src-elem", blocked: "inline", path: "/login", disposition: "report" }]);
    const api = summariseCspReports([
      { type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "eval", documentURL: "https://app.x/a" } },
      { type: "deprecation", body: {} },
    ]);
    expect(api).toHaveLength(1);
    expect(api[0].blocked).toBe("eval");
    expect(summariseCspReports("junk")).toEqual([]);
  });
});

describe("sanitiseReportPath token routes", () => {
  it.each([
    ["https://app.x/checkout/pr_Ab12Cd34", "/checkout/:id"],
    ["https://app.x/share/AbCdEfGhIjKlMnOpQrStUvWxYz", "/share/:id"],
    ["https://app.x/circle/join/k9Lmq2", "/circle/join/:id"],
    ["https://app.x/patient/vitals", "/patient/vitals"],
  ])("%s -> %s", (input, out) => {
    expect(sanitiseReportPath(input)).toBe(out);
  });
});
