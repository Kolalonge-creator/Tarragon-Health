import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

jest.mock("./audited-chart", () => ({ readAuditedSection: jest.fn() }));
jest.mock("./medications-audited", () => ({ readPatientMedicationsAudited: jest.fn() }));
import { readAuditedSection } from "./audited-chart";
import { readPatientMedicationsAudited } from "./medications-audited";
import { loadMedicationSafety } from "./patient-clinical-context";

/**
 * OQ-555 follow-up: the medication-safety view gets pregnancy from the database's three-state answer. An unreadable status is "possibly pregnant" to the
 * safety engine (its pregnancy caveat stays on) and is flagged for the panel; a readable "not pregnant" behaves as before (no caveat); pregnant is unchanged.
 */
const tables: string[] = [];
function clientWith(reply: unknown): SupabaseClient<Database> {
  const builder: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return {
    from: (t: string) => (tables.push(t), proxy),
    rpc: (name: string) => Promise.resolve(name === "pregnancy_safety_status" ? { data: reply, error: null } : { data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  tables.length = 0;
  (readAuditedSection as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>).mockResolvedValue({ status: "ok", rows: [] });
  (readPatientMedicationsAudited as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>).mockResolvedValue({ status: "ok", rows: [] });
});

describe("loadMedicationSafety pregnancy status", () => {
  it("unreadable: flagged for the panel, and the engine keeps its pregnancy caveat (cautious branch)", async () => {
    const view = await loadMedicationSafety(clientWith({ pregnancy: "unknown", has_record: false, last_delivery_date: null }), "p1");
    expect(view.pregnancyUnknown).toBe(true);
    // the cautious flag is on, but the note says what happened rather than claiming a self-report that never was
    expect(view.report.pregnancyCheckNote).toBe("Pregnancy status could not be read. Check before prescribing.");
  });

  it("the cautious branch really reaches the rules: an unreadable status fires the pregnancy contraindication on Gliclazide, a readable 'not pregnant' does not", async () => {
    (readPatientMedicationsAudited as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>).mockResolvedValue({
      status: "ok",
      rows: [{ id: "m1", drug_name: "Gliclazide", dose: "80mg", prescriber_name: null, source: "clinician" }],
    });
    const pregnancyFinding = (v: Awaited<ReturnType<typeof loadMedicationSafety>>) =>
      v.report.findings.some((f) => f.severity === "contraindicated" && /pregnan/i.test(`${f.title} ${f.message}`));
    const unknown = await loadMedicationSafety(clientWith({ pregnancy: "unknown", has_record: false, last_delivery_date: null }), "p1");
    const notPregnant = await loadMedicationSafety(clientWith({ pregnancy: "not_pregnant", has_record: true, last_delivery_date: null }), "p1");
    expect(pregnancyFinding(unknown)).toBe(true);
    expect(pregnancyFinding(notPregnant)).toBe(false);
  });

  it("a failed or malformed answer is the same as unreadable", async () => {
    const view = await loadMedicationSafety(clientWith({ nonsense: true }), "p1");
    expect(view.pregnancyUnknown).toBe(true);
    expect(view.report.pregnancyCheckNote).toMatch(/pregnan/i);
  });

  it("readable and not pregnant: behaves as today (no flag, no caveat)", async () => {
    const view = await loadMedicationSafety(clientWith({ pregnancy: "not_pregnant", has_record: true, last_delivery_date: null }), "p1");
    expect(view.pregnancyUnknown).toBe(false);
    expect(view.report.pregnancyCheckNote).toBeNull();
  });

  it("pregnant: behaves as today (no 'unknown' flag, the self-report caveat is shown)", async () => {
    const view = await loadMedicationSafety(clientWith({ pregnancy: "pregnant", has_record: true, last_delivery_date: null }), "p1");
    expect(view.pregnancyUnknown).toBe(false);
    expect(view.report.pregnancyCheckNote).toMatch(/self-reported/);
  });

  it("never reads patient_pregnancy straight from the table", async () => {
    await loadMedicationSafety(clientWith({ pregnancy: "not_pregnant", has_record: false, last_delivery_date: null }), "p1");
    expect(tables).not.toContain("patient_pregnancy");
  });
});
