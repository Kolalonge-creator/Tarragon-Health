import { describe, it, expect, jest } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";
import { composeHealthReport, type ComposedReport, type HealthReportFacts } from "@tarragon/clinical";
import { parseReportConfig } from "./build";
import { buildRenderModel, buildSharedReportModel, isReportExcludedCode, REPORT_EXCLUDED_CODE_PATTERN, type Block, type ReportRow } from "./render-model";

// the PDF library is ESM-only; the document is only walked as a React element tree here, never rendered
jest.mock("@react-pdf/renderer", () => {
  const C = () => null;
  return { Document: C, Page: C, Text: C, View: C, Svg: C, Path: C, Rect: C, Circle: C, Polygon: C, StyleSheet: { create: <T,>(x: T) => x } };
});

/**
 * S46d: charts and scorecards, the suggested recheck, the shared-link body and the blood-borne exclusion across every surface. The settings are the real
 * proposed v3 (with the retest block), so these also pin that the registry value parses.
 */
const CONFIG = parseReportConfig(getProposedConfig("report.settings").value);
const TODAY = new Date("2026-12-01");

const FACTS: HealthReportFacts = {
  year: 2026,
  bp: { count: 14, days: 6, firstAt: "2026-02-01T00:00:00Z", lastAt: "2026-10-01T00:00:00Z", avgSystolic: 152, avgDiastolic: 96 },
  bpPrior: null,
  bpCareTeamTarget: null,
  weight: null,
  devices: { manual: 5, device: 3, wearable: 0 },
  labs: [
    { code: "fasting_glucose", unit: "mg/dL", readingsThisYear: 1, latest: { at: "2026-05-01", value: 130, refLow: 70, refHigh: 99, flag: "high", unit: "mg/dL" }, previous: null },
    { code: "creatinine", unit: "mg/dL", readingsThisYear: 1, latest: { at: "2026-05-01", value: 0.9, refLow: 0.6, refHigh: 1.3, flag: "normal", unit: "mg/dL" }, previous: null },
  ],
  trends: [
    {
      code: "fasting_glucose",
      unitMixed: false,
      points: [
        { at: "2024-05-01", value: 96, unit: "mg/dL", refLow: 70, refHigh: 99 },
        { at: "2025-05-01", value: 108, unit: "mg/dL", refLow: 70, refHigh: 99 },
        { at: "2026-05-01", value: 130, unit: "mg/dL", refLow: 70, refHigh: 99 },
      ],
    },
  ],
  screening: { done: [{ code: "cervical_smear", on: "2026-03-01", reproductive: true }], due: [] },
  risk: { state: "not_assessed" },
  questionnaires: [],
};

const composed = (): ComposedReport & { templateSummary: string } => ({ ...composeHealthReport(FACTS, CONFIG, TODAY), templateSummary: "x" });
const row = (c: ComposedReport): ReportRow => ({ year: 2026, version: 1, composed: c, summary_text: "Your year in brief.", signer_name: "Dr A", signer_registration: "MDCN-1", signed_at: "2026-12-02T00:00:00Z", correction_note: null });
const blocks = (m: ReturnType<typeof buildRenderModel>, id: string): readonly Block[] => m.sections.find((s) => s.id === id)?.blocks ?? [];

describe("charts and scorecards (values from the signed snapshot only, words always with the picture)", () => {
  const m = buildRenderModel(row(composed()), CONFIG);

  it("draws a small line chart for a trend with at least two results, with a caption in words and the lab's own range", () => {
    const charts = blocks(m, "trends").filter((b) => b.kind === "chart");
    expect(charts).toHaveLength(1);
    const c = charts[0] as Extract<Block, { kind: "chart" }>;
    expect(c.geo.dots).toHaveLength(3);
    expect(c.geo.band).not.toBeNull();
    expect(c.caption).toContain("Fasting glucose");
    expect(c.caption).toContain("above the laboratory range");
    expect(c.caption).toContain("130");
    expect(c.notes.join(" ")).toContain("70 to 99");
    // the same numbers are also listed as text beside the chart
    expect(blocks(m, "trends").some((b) => b.kind === "line" && b.text.includes("2024-05 96"))).toBe(true);
  });

  it("never joins results reported in different units into one line", () => {
    const c = composed();
    const mixed: ComposedReport = {
      ...c,
      trends: [{ code: "creatinine", unitMixed: true, points: [
        { at: "2024-01-01", value: 1.0, unit: "mg/dL", refLow: 0.6, refHigh: 1.3 },
        { at: "2025-01-01", value: 88, unit: "umol/L", refLow: 53, refHigh: 115 },
      ] }],
    };
    expect(blocks(buildRenderModel(row(mixed), CONFIG), "trends").filter((b) => b.kind === "chart")).toHaveLength(0);
  });

  it("gives a scorecard bar to a lab value and to blood pressure, each with a sentence that says the same in words", () => {
    const items = blocks(m, "labs").concat(blocks(m, "bp")).filter((b): b is Extract<Block, { kind: "item" }> => b.kind === "item");
    const glucose = items.find((b) => b.label === "fasting glucose");
    expect(glucose?.gauge?.caption).toContain("above the laboratory range");
    expect(glucose?.stateWord).toBe("Needs attention");
    const bp = items.find((b) => b.label === "Blood pressure");
    expect(bp?.gauge?.caption).toContain("above the target");
    for (const b of items) if (b.gauge) {
      expect(b.gauge.marker).toBeGreaterThanOrEqual(0);
      expect(b.gauge.marker).toBeLessThanOrEqual(100);
      expect(b.gauge.bandFrom).toBeLessThanOrEqual(b.gauge.bandTo);
    }
  });

  it("prints in greyscale: the PDF and the web view use black and grey only, and the on-screen view uses currentColor", () => {
    const pdf = readFileSync(join(__dirname, "health-report-document.tsx"), "utf8");
    const hexes = [...pdf.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((x) => x[1]!.toLowerCase());
    for (const h of hexes) expect(h[0] === h[2] && h[2] === h[4] && h[1] === h[3] && h[3] === h[5]).toBe(true); // r = g = b: a grey
    const web = readFileSync(join(__dirname, "../../components/health-report-view.tsx"), "utf8");
    expect(web).not.toMatch(/#[0-9A-Fa-f]{6}|\bfill-(red|green|amber|blue)|\bstroke-(red|green|amber|blue)/);
  });
});

describe("suggested recheck", () => {
  it("shows a recheck line and the mid-year line for values that were off, from the settings' weeks, and says it is a suggestion", () => {
    const m = buildRenderModel(row(composed()), CONFIG);
    const text = JSON.stringify(blocks(m, "retest"));
    expect(text).toContain("fasting glucose: recheck in about 12 weeks.");
    expect(text).toContain("Blood pressure: recheck in about 4 weeks.");
    expect(text).toContain("mid-year check about 6 months");
    expect(text).toContain("not an appointment");
    // the on-target value gets none
    expect(text).not.toContain("creatinine");
  });

  it("older settings without a retest block give no recheck section at all", () => {
    const { retest: _retest, ...older } = CONFIG;
    const m = buildRenderModel(row(composeHealthReport(FACTS, older, TODAY)), older);
    expect(m.sections.find((s) => s.id === "retest")).toBeUndefined();
  });

  it("the proposed settings carry the block as UNSIGNED placeholders", () => {
    const e = getProposedConfig("report.settings");
    expect(e.status).toBe("proposed");
    expect((e.value as { statementApprovedByCmo: boolean }).statementApprovedByCmo).toBe(false);
    expect(CONFIG.retest).toEqual({ offValueWeeks: 12, bpWeeks: 4, byAnalyte: {}, midYearMonths: 6 });
  });
});

describe("blood-borne results are excluded by construction on every surface (INV-04)", () => {
  // A stored snapshot that wrongly carries sensitive material: every rendering must still leave it out.
  const dirty = (): ComposedReport => {
    const c = composed();
    const item = (code: string) => ({ ...c.items.find((i) => i.kind === "lab")!, id: `lab:${code}`, code, retestWeeks: 12 });
    return {
      ...c,
      items: [...c.items, item("hbsag"), item("hiv_screen"), item("hcv_ab"), item("anti_hbs")],
      trends: [...c.trends, { code: "hiv_screen", unitMixed: false, points: [{ at: "2025-01-01", value: 1, unit: null, refLow: null, refHigh: null }, { at: "2026-01-01", value: 1, unit: null, refLow: null, refHigh: null }] }],
      screening: { done: c.screening.done, due: [{ code: "hep_b", dueOn: "2026-01-01", status: "overdue", reproductive: false }] },
      priorities: [...c.priorities, { id: "lab:hbv_dna", category: "lab", action: "report.priority.lab.action", why: "report.priority.lab.why", whoHelps: "report.who.care_team", when: "within 4 weeks", params: { code: "hbv_dna", weeks: 4 } }],
      alsoWorthKnowing: [{ id: "lab:anti_hbs", category: "lab", action: "report.priority.lab.action", why: "report.priority.lab.why", whoHelps: "report.who.care_team", when: "within 4 weeks", params: { code: "anti_hbs", weeks: 4 } }],
    };
  };
  const NEEDLE = /hiv|hbsag|hbs_ag|hbs ag|hcv|hep_b|hep b|hepatitis|anti_hbs|anti hbs/i;

  it("the self view, the shared view and the shared-link body hold no trace of them in text, charts, rechecks or screening", () => {
    const r = row(dirty());
    expect(JSON.stringify(buildRenderModel(r, CONFIG, "self"))).not.toMatch(NEEDLE);
    expect(JSON.stringify(buildRenderModel(r, CONFIG, "shared"))).not.toMatch(NEEDLE);
    const body = { year: 2026, version: 1, signed_at: "2026-12-02T00:00:00Z", signer_name: "Dr A", signer_registration: "MDCN-1", composed: dirty() };
    expect(JSON.stringify(buildSharedReportModel(body))).not.toMatch(NEEDLE);
  });

  it("control: an ordinary lab code still appears, so the filter is not just emptying the report", () => {
    expect(JSON.stringify(buildRenderModel(row(dirty()), CONFIG))).toContain("fasting glucose");
  });

  it("the PDF document built from the model holds no trace either", async () => {
    const { HealthReportDocument } = await import("./health-report-document");
    const model = buildRenderModel(row(dirty()), CONFIG, "shared");
    expect(JSON.stringify(HealthReportDocument({ model, standingLine: "x" }))).not.toMatch(NEEDLE);
  });

  it("the code filter is the database's own list (public.report_excluded_code)", () => {
    const dir = join(__dirname, "../../../../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_s46_results_serology_health_report.sql")) as string;
    const m = /report_excluded_code[\s\S]*?~ '\(\^\|\[\^a-z\]\)\(([^)]*)\)/.exec(readFileSync(join(dir, file), "utf8"));
    expect(REPORT_EXCLUDED_CODE_PATTERN.source).toContain(m?.[1] as string);
    for (const code of ["hiv", "HBsAg", "hcv_ab", "anti_hbs", "hbv_dna"]) expect(isReportExcludedCode(code)).toBe(true);
    expect(isReportExcludedCode("fasting_glucose")).toBe(false);
  });
});

describe("the mid-year line cannot reveal a withheld item", () => {
  it("is shown only while an item that remains in the copy needs attention", () => {
    const c = composed();
    expect(JSON.stringify(blocks(buildRenderModel(row(c), CONFIG), "retest"))).toContain("mid-year");
    const onlyFine: ComposedReport = { ...c, items: c.items.filter((i) => i.state === "on_target"), midYearRetestMonths: 6 };
    expect(JSON.stringify(blocks(buildRenderModel(row(onlyFine), CONFIG), "retest"))).not.toContain("mid-year");
    // a caregiver copy that kept no off item must not say one exists
    expect(JSON.stringify(buildRenderModel(row(onlyFine), CONFIG))).not.toContain("outside their range");
  });
});

describe("the shared-link view", () => {
  it("leaves out the heart risk band, questionnaires, reproductive screening and the doctor's note, and recomputes the summary from what remains", () => {
    const c = composed();
    const leaky: ComposedReport = {
      ...c,
      risk: { state: "assessed", bandCode: "10to20", tier: "high", lowPct: 10, highPct: 20, model: "x", assessedAt: "2026-01-01", basedOn: { smoking: true } },
      questionnaires: [{ type: "diabetes_risk", level: "high", at: "2026-01-01" }],
    };
    const body = { year: 2026, version: 1, signed_at: "2026-12-02T00:00:00Z", signer_name: "Dr A", signer_registration: "MDCN-1", composed: leaky };
    const m = buildSharedReportModel(body);
    const text = JSON.stringify(m);
    expect(text).not.toContain("Your heart health risk band");
    expect(text).not.toContain("cervical smear");
    expect(text).not.toContain("Your year in brief.");
    expect(text).toContain("shared copy of a yearly health report");
    expect(m.variant).toBe("shared");
    expect(m.signedLine).toContain("MDCN-1");
  });
});
