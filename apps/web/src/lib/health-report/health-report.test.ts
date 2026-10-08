import { describe, it, expect, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getProposedConfig } from "@tarragon/shared";
import { composeHealthReport, shareableView, type HealthReportFacts } from "@tarragon/clinical";
import { buildHealthReportDraft, parseReportConfig } from "./build";
import { buildRenderModel, type ReportRow } from "./render-model";

const CONFIG = parseReportConfig(getProposedConfig("report.settings").value);

const FACTS: HealthReportFacts = {
  year: 2026,
  bp: { count: 14, days: 6, firstAt: "2026-02-01T00:00:00Z", lastAt: "2026-10-01T00:00:00Z", avgSystolic: 150, avgDiastolic: 96 },
  bpPrior: null,
  bpCareTeamTarget: null,
  weight: null,
  devices: { manual: 5, device: 3, wearable: 0 },
  labs: [{ code: "ldl", unit: "mg/dL", readingsThisYear: 1, latest: { at: "2026-05-01", value: 100, refLow: null, refHigh: 130, flag: "normal", unit: "mg/dL" }, previous: null }],
  trends: [],
  screening: { done: [{ code: "cervical_smear", on: "2026-03-01", reproductive: true }], due: [] },
  risk: { state: "not_assessed" },
  questionnaires: [],
};

function fakeService(opts: { rpcError?: string; facts?: unknown; allowed?: string }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    from: jest.fn((table: string) => {
      const row = table === "health_report_config_versions" ? { config: getProposedConfig("report.settings").value } : null;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) chain[m] = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: row, error: null }));
      return chain;
    }),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "health_report_build_allowed") return { data: opts.allowed ?? "ok", error: null };
      if (fn === "health_report_collect") return { data: opts.facts ?? FACTS, error: null };
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: "11111111-1111-1111-1111-111111111111", error: null };
    }),
  } as unknown as SupabaseClient<Database>;
  return { service, calls };
}

describe("buildHealthReportDraft", () => {
  it("collects in the database, composes, and writes through the service-role writer with the AI draft only as a separate argument", async () => {
    const { service, calls } = fakeService({});
    const out = await buildHealthReportDraft(service, { patientId: "p", year: 2026, draftSummary: async () => "A drafted paragraph." });
    expect(out).toEqual({ status: "created", reportId: "11111111-1111-1111-1111-111111111111" });
    const write = calls.find((c) => c.fn === "record_health_report_draft")!;
    expect(write.args.p_ai_draft).toBe("A drafted paragraph.");
    // INV-11: the draft text is nowhere in what the patient will read (composed, priorities)
    expect(JSON.stringify([write.args.p_composed, write.args.p_priorities])).not.toContain("A drafted paragraph.");
    expect((write.args.p_priorities as unknown[]).length).toBeLessThanOrEqual(3);
    expect((write.args.p_composed as { templateSummary: string }).templateSummary).toContain("on target");
  });

  it("requests NO AI draft and collects nothing while the guard is off, the settings are unsigned or a draft is waiting (review fix)", async () => {
    for (const [allowed, reason] of [["guard_off", "guard_off"], ["settings_unsigned", "settings_unsigned"], ["draft_waiting", "draft_waiting"]] as const) {
      const { service, calls } = fakeService({ allowed });
      const drafter = jest.fn(async () => "never asked");
      const out = await buildHealthReportDraft(service, { patientId: "p", year: 2026, draftSummary: drafter });
      expect(out).toEqual({ status: "refused", reason });
      expect(drafter).not.toHaveBeenCalled();
      expect(calls.map((c) => c.fn)).not.toContain("health_report_collect");
      expect(calls.map((c) => c.fn)).not.toContain("record_health_report_draft");
    }
  });

  it("control: when the pre-check says ok the drafter is asked", async () => {
    const { service } = fakeService({ allowed: "ok" });
    const drafter = jest.fn(async () => "a draft");
    await buildHealthReportDraft(service, { patientId: "p", year: 2026, draftSummary: drafter });
    expect(drafter).toHaveBeenCalledTimes(1);
  });

  it("a failing AI drafter never blocks a report and leaves no draft text", async () => {
    const { service, calls } = fakeService({});
    const out = await buildHealthReportDraft(service, {
      patientId: "p",
      year: 2026,
      draftSummary: async () => {
        throw new Error("model down");
      },
    });
    expect(out.status).toBe("created");
    expect(calls.find((c) => c.fn === "record_health_report_draft")!.args.p_ai_draft).toBeUndefined();
  });

  it("maps the database refusals to plain reasons (guard off, settings unsigned, draft waiting)", async () => {
    expect(await buildHealthReportDraft(fakeService({ rpcError: "not_live: yearly report generation is not switched on" }).service, { patientId: "p", year: 2026 })).toEqual({ status: "refused", reason: "guard_off" });
    expect(await buildHealthReportDraft(fakeService({ rpcError: "not_live: the report settings are not signed" }).service, { patientId: "p", year: 2026 })).toEqual({ status: "refused", reason: "settings_unsigned" });
    expect(await buildHealthReportDraft(fakeService({ rpcError: "draft_already_waiting_for_signature" }).service, { patientId: "p", year: 2026 })).toEqual({ status: "refused", reason: "draft_waiting" });
  });
});

describe("the rendered report", () => {
  const composed = { ...composeHealthReport(FACTS, CONFIG, new Date("2026-12-01")), templateSummary: "x" };
  const row: ReportRow = { year: 2026, version: 2, composed, summary_text: "Your year in brief.", signer_name: "Dr A", signer_registration: "MDCN-1", signed_at: "2026-12-02T00:00:00Z", correction_note: "A lab corrected a value." };
  const flat = (m: ReturnType<typeof buildRenderModel>) => JSON.stringify(m);

  it("shows the signer, registration number, version and the visible correction note", () => {
    const m = buildRenderModel(row, CONFIG);
    expect(m.signedLine).toContain("Dr A");
    expect(m.signedLine).toContain("MDCN-1");
    expect(m.versionLine).toBe("Version 2");
    expect(m.correctionLine).toContain("A lab corrected a value.");
  });

  it("always carries the fixed screening statement, the emergency signs and a words-plus-symbol state for each item", () => {
    const m = buildRenderModel(row, CONFIG);
    const text = flat(m);
    expect(text).toContain("It is not a diagnosis");
    expect(text).toContain("whatever this report says");
    expect(text).toContain("Call 112");
    expect(m.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["summary", "priorities", "cannot_tell", "emergency"]));
    const items = m.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "item");
    expect(items.length).toBeGreaterThan(0);
    for (const b of items) {
      if (b.kind === "item") {
        expect(b.stateWord.length).toBeGreaterThan(0);
        expect(b.symbol).toMatch(/^\[.+\]$/);
      }
    }
  });

  it("says not assessed when there is no signed risk band, and never invents one", () => {
    const m = buildRenderModel(row, CONFIG);
    expect(flat(m)).toContain("Not assessed.");
  });

  it("a shared copy leaves out reproductive screening, the risk section and questionnaires unless included", () => {
    const shared = flat(buildRenderModel(row, CONFIG, "shared"));
    expect(shared).not.toContain("cervical smear");
    expect(shared).not.toContain("Your heart health risk band");
    expect(flat(buildRenderModel(row, CONFIG, "shared", ["screening_reproductive"]))).toContain("cervical smear");
    expect(flat(buildRenderModel(row, CONFIG, "self"))).toContain("cervical smear");
  });

  it("uses no em dash, no 'your doctor', no optimal range and no colour-only meaning in its text", () => {
    const text = flat(buildRenderModel(row, CONFIG));
    expect(text).not.toMatch(/—|your doctor|optimal|biological age|healthspan/i);
  });

  it("the lower higher-risk target is explained to the patient, but a shared copy shows only the number and never says why (review fix)", () => {
    const hr = { ...FACTS, bpHigherRisk: { diabetes: true, ckd: false, cvd: false, elevatedRisk: false } };
    const c = { ...composeHealthReport(hr, CONFIG, new Date("2026-12-01")), templateSummary: "x" };
    const r: ReportRow = { ...row, composed: c };
    const own = flat(buildRenderModel(r, CONFIG, "self"));
    const shared = flat(buildRenderModel(r, CONFIG, "shared"));
    expect(own).toContain("extra health risks");
    expect(shared).not.toContain("extra health risks");
    expect(shared).toContain("Target: below 130/80 mmHg.");
    expect(JSON.stringify(shareableView(c, CONFIG).items)).not.toContain("higher_risk");
    // control: the unshared composed report does still carry the source
    expect(JSON.stringify(c.items)).toContain("higher_risk");
  });
});
