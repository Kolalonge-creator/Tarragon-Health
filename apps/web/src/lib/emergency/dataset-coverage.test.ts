jest.mock("server-only", () => ({}));

import { loadEmergencyDatasetForPatient } from "./dataset";

/** A table-by-table stub of the supabase client: every read returns the rows given for that table. */
function client(rows: Record<string, unknown>, calls: string[]) {
  return {
    from: (table: string) => {
      calls.push(table);
      const result = { data: rows[table] ?? null, error: null };
      const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res), maybeSingle: () => Promise.resolve(result) };
      for (const m of ["select", "eq", "is", "order"]) b[m] = () => b;
      return b;
    },
  } as never;
}
const ROWS = {
  profiles: { full_name: "Ada Obi" },
  patient_allergies: [],
  medications: [],
  care_plans: [],
  patient_blood_profile: null,
  emergency_card_coverage: { scheme: "hmo", member_number: "REL/12345", plan_name: "Reliance Gold" },
};

describe("loadEmergencyDatasetForPatient and cover (S09y)", () => {
  it("leaves cover out, and does not even read it, unless the caller asks (the lock-screen picture never asks)", async () => {
    const calls: string[] = [];
    const facts = await loadEmergencyDatasetForPatient(client(ROWS, calls), "p1", { strict: true });
    expect(facts.coverage).toBeNull();
    expect(calls).not.toContain("emergency_card_coverage");
  });
  it("returns cover, patient entered, when asked (the printed card and the preview)", async () => {
    const calls: string[] = [];
    const facts = await loadEmergencyDatasetForPatient(client(ROWS, calls), "p1", { includeCoverage: true });
    expect(facts.coverage).toEqual({ scheme: "hmo", member_number: "REL/12345", plan_name: "Reliance Gold", provenance: "patient_entered" });
    expect(calls).toContain("emergency_card_coverage");
  });
});
