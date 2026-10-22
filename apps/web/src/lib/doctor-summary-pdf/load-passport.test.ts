import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { summaryConfig } from "./model";
import { SAMPLE_NOW_MS } from "./sample-data";
import { loadDoctorSummary } from "./load";

/**
 * Item 10: the loader's two new reads. They run as the patient (row level security), and each states its own safety filters in the query so
 * they do not depend on a policy alone: sensitive positive results are excluded by `.eq("sensitive_positive", false)`, only reports that are
 * final, corrected or amended are read, and nothing superseded. A read error fails the whole document.
 */
type Call = [string, ...unknown[]];

function client(tableResults: Record<string, { data: unknown; error: { message: string } | null }>) {
  const calls: Record<string, Call[]> = {};
  const from = (table: string) => {
    const log = (calls[table] ??= []);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gte", "order", "limit", "in", "not", "or"]) {
      b[m] = (...args: unknown[]) => {
        log.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = async () => ({ data: { full_name: "Ada", date_of_birth: null, sex: null, patient_number: null }, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve(tableResults[table] ?? { data: [], error: null });
    return b;
  };
  return { c: { from } as unknown as SupabaseClient<Database>, calls };
}
const ask = (sections: ("glucose" | "lab_results")[]) => ({ days: 30, sections });

describe("loadDoctorSummary: result passport sections", () => {
  it("reads labs with every safety filter stated in the query", async () => {
    const f = client({ lab_analyte_readings: { data: [], error: null } });
    const r = await loadDoctorSummary(f.c, "p1", ask(["lab_results"]), SAMPLE_NOW_MS, summaryConfig());
    expect(r.ok).toBe(true);
    const q = f.calls.lab_analyte_readings;
    expect(q).toContainEqual(["eq", "patient_id", "p1"]);
    expect(q).toContainEqual(["eq", "sensitive_positive", false]);
    expect(q).toContainEqual(["in", "report_status", ["final", "corrected", "amended"]]);
    expect(q).toContainEqual(["is", "correction_status", null]);
    expect(q).toContainEqual(["is", "superseded_by_id", null]);
  });

  it("does not touch the lab or glucose tables when they are not ticked", async () => {
    const f = client({});
    await loadDoctorSummary(f.c, "p1", { days: 30, sections: ["medicines"] as never }, SAMPLE_NOW_MS, summaryConfig());
    expect(Object.keys(f.calls)).not.toContain("lab_analyte_readings");
    expect(f.calls.vitals_readings ?? []).toEqual([]);
  });

  it("reads glucose readings for this patient, in the period, not corrected", async () => {
    const f = client({ vitals_readings: { data: [], error: null } });
    await loadDoctorSummary(f.c, "p1", ask(["glucose"]), SAMPLE_NOW_MS, summaryConfig());
    const q = f.calls.vitals_readings;
    expect(q).toContainEqual(["eq", "patient_id", "p1"]);
    expect(q).toContainEqual(["eq", "vital_type", "glucose"]);
    expect(q).toContainEqual(["is", "correction_status", null]);
    expect(q.some((c) => c[0] === "gte" && c[1] === "taken_at")).toBe(true);
  });

  it("fails the whole document, with no partial result, when a passport section cannot be read", async () => {
    const labs = await loadDoctorSummary(client({ lab_analyte_readings: { data: null, error: { message: "x" } } }).c, "p1", ask(["lab_results"]), SAMPLE_NOW_MS, summaryConfig());
    expect(labs).toEqual({ ok: false, error: "Could not read your lab results." });
    const sugar = await loadDoctorSummary(client({ vitals_readings: { data: null, error: { message: "x" } } }).c, "p1", ask(["glucose"]), SAMPLE_NOW_MS, summaryConfig());
    expect(sugar).toEqual({ ok: false, error: "Could not read your blood sugar readings." });
  });

  it("drops a sensitive row even if the query were to return one", async () => {
    const row = { code: "hba1c", value: 6.9, value_text: null, unit: "%", reference_range_text: null, range_source: "laboratory", range_source_ref: null, abnormal_flag: null, taken_at: "2026-10-01T00:00:00Z", laboratory: "L", sensitive_positive: false };
    const f = client({ lab_analyte_readings: { data: [row, { ...row, code: "hbsag", value_text: "Reactive", sensitive_positive: true }], error: null } });
    const r = await loadDoctorSummary(f.c, "p1", ask(["lab_results"]), SAMPLE_NOW_MS, summaryConfig());
    expect(r.ok && r.data.labs?.lines.map((l) => l.label)).toEqual(["HbA1c"]);
    expect(JSON.stringify(r)).not.toMatch(/hbsag|reactive/i);
  });
});
