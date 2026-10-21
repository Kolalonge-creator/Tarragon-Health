import { describe, expect, it } from "@jest/globals";
import { loadSignedReports, type ReportCache } from "./health-report";
import { asSignedReport, buildMobileReportView, signedReports } from "./health-report-view";

jest.mock("./supabase", () => ({ supabase: {} }));

const composed = {
  items: [
    { id: "bp", kind: "bp", code: "blood_pressure", state: "needs_attention", value: 152, value2: 96, unit: "mmHg", retestWeeks: 4 },
    { id: "lab:alt", kind: "lab", code: "alt", state: "on_target", value: 30, unit: "U/L" },
    { id: "lab:hbsag", kind: "lab", code: "hbsag", state: "needs_attention", value: 1, unit: null },
    { id: "lab:hiv_screen", kind: "lab", code: "hiv_screen", state: "needs_attention", value: 1, unit: null },
    { id: "lab:anti_hbs", kind: "lab", code: "anti_hbs", state: "on_target", value: 1, unit: null },
  ],
  priorities: [{ id: "bp", action: "report.priority.bp.action", why: "report.priority.bp.why", whoHelps: "report.who.care_team", when: "within 4 weeks", params: { count: 14 } }],
  trends: [
    { code: "alt", points: [{ at: "2025-01-01", value: 28, unit: "U/L" }, { at: "2026-01-01", value: 30, unit: "U/L" }] },
    { code: "hcv_ab", points: [{ at: "2025-01-01", value: 1, unit: null }, { at: "2026-01-01", value: 1, unit: null }] },
  ],
  midYearRetestMonths: 6,
  statementKey: "report.statement.not_rule_out",
};
const signed = (over: Record<string, unknown> = {}) => ({
  id: "r1", year: 2026, version: 1, status: "signed", summary_text: "Your year in brief.", signer_name: "Dr A", signer_registration: "MDCN-1",
  signed_at: "2026-12-02T00:00:00Z", correction_note: null, composed, ...over,
});

function memoryCache(): ReportCache & { store: Map<string, { payload: string; cachedAt: string }> } {
  const store = new Map<string, { payload: string; cachedAt: string }>();
  return {
    store,
    read: async (u) => store.get(u) ?? null,
    write: async (u, payload, cachedAt) => void store.set(u, { payload, cachedAt }),
    clear: async (u) => void store.delete(u),
  };
}

describe("nothing is shown or kept before a clinician has signed", () => {
  it("drops a row with no signed_at, no signer, no registration, no paragraph or a status other than signed", () => {
    for (const bad of [{ signed_at: null }, { signed_at: "not a date" }, { signer_name: "" }, { signer_registration: null }, { summary_text: "  " }, { status: "pending_signature" }, { status: "superseded" }]) {
      expect(asSignedReport(signed(bad))).toBeNull();
    }
    expect(asSignedReport(signed())).not.toBeNull();
    expect(signedReports([signed({ id: "d", signed_at: null, status: "pending_signature" }), signed()]).map((r) => r.id)).toEqual(["r1"]);
  });

  it("an unsigned draft from the server is neither returned nor saved on the phone", async () => {
    const cache = memoryCache();
    const out = await loadSignedReports({ userId: "u", cache, fetchRows: async () => [signed({ signed_at: null, status: "pending_signature", summary_text: "DRAFT TEXT" })] });
    expect(out).toEqual({ kind: "empty" });
    expect(cache.store.size).toBe(0);
    expect(JSON.stringify(out)).not.toContain("DRAFT TEXT");
  });

  it("a saved copy that fails the signed check shows nothing (tampered or damaged)", async () => {
    const cache = memoryCache();
    cache.store.set("u", { payload: JSON.stringify([signed({ signed_at: null })]), cachedAt: "2026-12-03T00:00:00Z" });
    expect(await loadSignedReports({ userId: "u", cache, fetchRows: async () => null })).toEqual({ kind: "error" });
    cache.store.set("u", { payload: "{not json", cachedAt: "2026-12-03T00:00:00Z" });
    expect(await loadSignedReports({ userId: "u", cache, fetchRows: async () => null })).toEqual({ kind: "error" });
  });
});

describe("offline reading", () => {
  it("saves a signed report after a good read, and reads it back with no signal", async () => {
    const cache = memoryCache();
    const first = await loadSignedReports({ userId: "u", cache, fetchRows: async () => [signed()], now: () => new Date("2026-12-03T10:00:00Z") });
    expect(first.kind).toBe("fresh");
    const offline = await loadSignedReports({ userId: "u", cache, fetchRows: async () => null });
    expect(offline).toMatchObject({ kind: "cached", cachedAt: "2026-12-03T10:00:00.000Z" });
    expect(offline.kind === "cached" && offline.reports[0]?.signer_name).toBe("Dr A");
    // a thrown network error is the same as a failed read
    expect((await loadSignedReports({ userId: "u", cache, fetchRows: async () => { throw new Error("offline"); } })).kind).toBe("cached");
  });

  it("a copy is per person, and a good read with no signed report clears it", async () => {
    const cache = memoryCache();
    await loadSignedReports({ userId: "u", cache, fetchRows: async () => [signed()] });
    expect((await loadSignedReports({ userId: "someone-else", cache, fetchRows: async () => null })).kind).toBe("error");
    expect((await loadSignedReports({ userId: "u", cache, fetchRows: async () => [] })).kind).toBe("empty");
    expect(cache.store.has("u")).toBe(false);
    expect((await loadSignedReports({ userId: "u", cache, fetchRows: async () => null })).kind).toBe("error");
  });

  it("a failed save never hides a report in hand", async () => {
    const cache: ReportCache = { read: async () => null, write: async () => { throw new Error("disk full"); }, clear: async () => undefined };
    expect((await loadSignedReports({ userId: "u", cache, fetchRows: async () => [signed()] })).kind).toBe("fresh");
  });
});

describe("the phone view", () => {
  const view = buildMobileReportView(asSignedReport(signed())!);
  const flat = JSON.stringify(view);

  it("shows the signer, the summary, words with symbols, the recheck line and the fixed statement and emergency signs", () => {
    expect(view.signedLine).toContain("MDCN-1");
    expect(view.summary).toBe("Your year in brief.");
    const bp = view.items.find((i) => i.label === "Blood pressure")!;
    expect(bp).toMatchObject({ symbol: "[!]", stateWord: "Needs attention", value: "152/96 mmHg" });
    expect(bp.retest).toContain("about 4 weeks");
    expect(view.midYear).toContain("about 6 months");
    expect(view.statement).toContain("not a diagnosis");
    expect(view.emergency).toContain("Call 112");
    expect(view.priorities[0]?.action).toContain("blood pressure");
  });

  it("holds no trace of HIV, hepatitis or anti-HBs even when the stored snapshot carries them (INV-04)", () => {
    expect(flat).not.toMatch(/hiv|hbsag|hcv|hep_b|hepatitis|anti.?hbs/i);
    expect(view.items.map((i) => i.label)).toContain("alt");
    expect(view.trends.map((t) => t.label)).toEqual(["alt"]);
  });

  it("uses no em dash", () => {
    expect(flat).not.toContain("—");
  });
});
