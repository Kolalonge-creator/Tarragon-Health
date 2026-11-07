import { PROVIDERS, providerLine, statusSchema, type Activity } from "./model";

const t = (iso: string) => `at ${iso}`;
const a = (o: Partial<Activity>): Activity => ({ ok_7d: 0, failed_7d: 0, last_ok_at: null, last_failed_at: null, ...o });

describe("providerLine", () => {
  it("never calls a provider operational on a key alone", () => {
    expect(providerLine(null, true, t).state).toBe("unknown");
    expect(providerLine(a({}), true, t).state).toBe("unknown");
  });

  it("says not configured when there is no key and nothing recorded", () => {
    expect(providerLine(null, false, t).state).toBe("not_configured");
    expect(providerLine(a({}), false, t).state).toBe("not_configured");
  });

  it("is quiet, not broken, when it worked before but not this week", () => {
    expect(providerLine(a({ last_ok_at: "x" }), true, t)).toEqual({ state: "unknown", evidence: "Nothing in the last 7 days; last success at x." });
  });

  it("is failed when everything failed, degraded at a 20% failure share, operational below it", () => {
    expect(providerLine(a({ failed_7d: 3 }), true, t).state).toBe("failed");
    // The live push figures on 2026-11-07: 26 failed against 27 sent.
    expect(providerLine(a({ ok_7d: 27, failed_7d: 26 }), true, t)).toEqual({ state: "degraded", evidence: "26 of 53 failed in the last 7 days (49%)." });
    expect(providerLine(a({ ok_7d: 4, failed_7d: 1 }), true, t).state).toBe("degraded");
    expect(providerLine(a({ ok_7d: 9, failed_7d: 1, last_ok_at: "y" }), true, t)).toEqual({ state: "operational", evidence: "9 succeeded, 1 failed in the last 7 days; last success at y." });
  });

  it("lets rejected webhooks degrade a provider only when they outnumber good ones (a stray probe is not an outage)", () => {
    expect(providerLine(a({ ok_7d: 5, webhooks_ok_7d: 10, webhooks_bad_7d: 1 }), true, t).state).toBe("operational");
    expect(providerLine(a({ ok_7d: 5, webhooks_ok_7d: 1, webhooks_bad_7d: 4 }), true, t).state).toBe("degraded");
  });

  it("treats a provider with only webhooks this week as unknown, since our own calls are what prove it works", () => {
    expect(providerLine(a({ webhooks_ok_7d: 2 }), true, t).state).toBe("unknown");
  });
});

describe("PROVIDERS", () => {
  it("lists every provider the status function reports, plus Google Maps, which has no server record", () => {
    const fromFunction = Object.keys(statusSchema.shape).filter((k) => k !== "computed_at" && k !== "since").sort();
    expect(PROVIDERS.map((p) => p.key).filter((k) => k !== "maps").sort()).toEqual(fromFunction);
    expect(PROVIDERS.some((p) => p.key === "maps")).toBe(true);
  });

  it("never names WhatsApp or a second payment provider (removed, F-02; Paystack only)", () => {
    const text = JSON.stringify(PROVIDERS).toLowerCase();
    expect(text).not.toContain("whatsapp");
    expect(text).not.toContain("flutterwave");
    expect(text).not.toContain("stripe");
  });
});
