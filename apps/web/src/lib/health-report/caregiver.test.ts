import { describe, it, expect, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getProposedConfig } from "@tarragon/shared";
import { parseReportConfig } from "./build";
import { getCaregiverReport, listCaregiverReports } from "./caregiver";
import { buildRenderModel, type ReportRow } from "./render-model";

const CONFIG = parseReportConfig(getProposedConfig("report.settings").value);
const ID = "11111111-1111-4111-8111-111111111111";

function client(rpc: (name: string) => { data: unknown; error: { message: string } | null }, cfg: unknown = getProposedConfig("report.settings").value): SupabaseClient<Database> {
  return {
    rpc: jest.fn((name: string) => Promise.resolve(rpc(name))),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: cfg ? { config: cfg } : null }) }) }) }),
  } as unknown as SupabaseClient<Database>;
}

const payload = (over: Record<string, unknown> = {}) => ({
  id: ID,
  patient_id: ID,
  first_name: "Ada",
  year: 2026,
  version: 1,
  config_version_id: ID,
  summary_text: null,
  summary_withheld: true,
  signer_name: "Dr Test",
  signer_registration: "MDCN-1",
  signed_at: "2026-10-01T00:00:00Z",
  correction_note: null,
  withheld: ["bp", "devices", "risk"],
  composed: {
    schema: 1,
    year: 2026,
    items: [{ id: "lab:alt", kind: "lab", code: "alt", state: "needs_attention", value: 70, value2: null, unit: "U/L", readingCount: 1, tooFewReadings: false, minReadings: null, borderline: false, recheckWeeks: null, target: null, change: "no_comparison", previousValue: null, dateFrom: null, dateTo: null, reason: null, excess: 0 }],
    priorities: [],
    alsoWorthKnowing: [],
    summary: { key: "report.summary.default", params: {} },
    risk: { state: "not_assessed" },
    screening: { done: [], due: [] },
    trends: [],
    questionnaires: [],
    devices: { manual: 0, device: 0, wearable: 0 },
    weight: null,
    statementKey: "report.statement.not_rule_out",
    statementApprovedByCmo: false,
    minBpReadings: 12,
    minBpDays: 3,
  },
  ...over,
});

describe("caregiver read of a signed report (S46c)", () => {
  it("returns null for every refusal, so nothing says why", async () => {
    expect(await getCaregiverReport(client(() => ({ data: null, error: { message: "report_not_found" } })), ID)).toBeNull();
    expect(await getCaregiverReport(client(() => ({ data: null, error: null })), ID)).toBeNull();
  });

  it("returns null when the answer is not the expected shape", async () => {
    expect(await getCaregiverReport(client(() => ({ data: { id: "x" }, error: null })), ID)).toBeNull();
  });

  it("returns null when the report settings cannot be read", async () => {
    expect(await getCaregiverReport(client(() => ({ data: payload(), error: null }), null), ID)).toBeNull();
  });

  it("carries the withheld sections and the summary flag through", async () => {
    const r = await getCaregiverReport(client(() => ({ data: payload(), error: null })), ID);
    expect(r?.caregiver).toEqual({ withheld: ["bp", "devices", "risk"], summaryWithheld: true });
    expect(r?.firstName).toBe("Ada");
  });

  it("lists first name, year and version only", async () => {
    const list = await listCaregiverReports(client(() => ({ data: [{ patient_id: ID, first_name: "Ada", year: 2026, version: 2, signed_at: "x" }], error: null })));
    expect(list).toEqual([{ patientId: ID, firstName: "Ada", year: 2026, version: 2 }]);
    expect(await listCaregiverReports(client(() => ({ data: null, error: { message: "x" } })))).toEqual([]);
  });
});

describe("render model for a caregiver", () => {
  async function model(variant: "self" | "shared") {
    const r = await getCaregiverReport(client(() => ({ data: payload(), error: null })), ID);
    if (!r) throw new Error("no report");
    return buildRenderModel(r.row as ReportRow, CONFIG, variant, [], r.caregiver);
  }

  it("leaves out the sections the grant did not cover and says so", async () => {
    const m = await model("self");
    const ids = m.sections.map((s) => s.id);
    expect(ids).not.toContain("bp");
    expect(ids).not.toContain("devices");
    expect(ids).not.toContain("risk");
    expect(ids).toContain("labs");
    expect(ids[ids.length - 1]).toBe("withheld_note");
  });

  it("does not print the doctor's summary when it is withheld", async () => {
    const m = await model("self");
    const summary = m.sections.find((s) => s.id === "summary");
    expect(JSON.stringify(summary)).toContain("not shown");
  });

  it("the shared copy still works for a caregiver", async () => {
    const m = await model("shared");
    expect(m.variant).toBe("shared");
  });

  it("without caregiver options nothing changes (patient view)", () => {
    const row = { year: 2026, version: 1, composed: payload().composed, summary_text: "Your year.", signer_name: "Dr T", signer_registration: "1", signed_at: "2026-10-01T00:00:00Z", correction_note: null } as unknown as ReportRow;
    const m = buildRenderModel(row, CONFIG, "self");
    expect(m.sections.map((s) => s.id)).toContain("devices");
    expect(m.sections.map((s) => s.id)).toContain("risk");
    expect(m.sections.map((s) => s.id)).not.toContain("withheld_note");
  });

  it("a caregiver sees the target number but never the reason it is lower (review fix)", async () => {
    const p = payload({ withheld: [] });
    const bp = { id: "bp", kind: "bp", code: "blood_pressure", state: "needs_attention", value: 134, value2: 84, unit: "mmHg", readingCount: 14, readingDays: 6, tooFewReadings: false, minReadings: 12, borderline: true, recheckWeeks: 4,
      target: { low: null, high: 130, high2: 80, source: "higher_risk" }, change: "no_comparison", previousValue: null, dateFrom: null, dateTo: null, reason: null, excess: 4 };
    (p.composed as { items: unknown[] }).items = [bp];
    const out = await getCaregiverReport(client(() => ({ data: p, error: null })), ID);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out!.row.composed)).not.toContain("higher_risk");
    const m = buildRenderModel(out!.row, out!.config, "self", [], out!.caregiver);
    const text = JSON.stringify(m);
    expect(text).toContain("Target: below 130/80 mmHg.");
    expect(text).not.toContain("extra health risks");
    // control: the same item rendered for the patient themselves does explain it
    expect(JSON.stringify(buildRenderModel({ ...out!.row, composed: { ...out!.row.composed, items: [bp] as never } }, out!.config, "self"))).toContain("extra health risks");
  });
});
