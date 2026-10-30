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
    expect(view.report.pregnancyCheckNote).toMatch(/pregnan/i);
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
