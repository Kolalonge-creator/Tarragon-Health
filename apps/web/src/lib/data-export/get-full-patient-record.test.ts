import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getFullPatientRecordExport, readCorrectedEntries } from "./get-full-patient-record";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A client where every table read answers `rows` and the one rpc answers `rpc`; the profile read answers a single object. */
function fakeClient(rpc: Result): SupabaseClient<Database> {
  const profile = { id: "p1", patient_number: null, full_name: "A", phone: null, sex: null, date_of_birth: null, state: null, city: null, area: null, language: "en", emergency_contact_name: null, emergency_contact_phone: null, emergency_contact_relationship: null };
  const chain = (single: boolean): unknown => {
    const result = { data: single ? profile : [], error: null };
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) self[m] = () => self;
    self.single = async () => result;
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return self;
  };
  return {
    from: (table: string) => chain(table === "profiles"),
    rpc: async (name: string, args: unknown) => {
      expect(name).toBe("my_corrected_record_entries");
      expect(args).toEqual({ p_patient: "p1" });   // asked for the patient the rest of the export is about, never implicitly the caller
      return rpc;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("readCorrectedEntries", () => {
  it("keeps each table's rows and turns anything malformed into an empty history", () => {
    expect(readCorrectedEntries({ patient_allergies: [{ id: "a" }], vitals_readings: "oops" })).toEqual({
      patient_allergies: [{ id: "a" }],
      vitals_readings: [],
    });
    expect(readCorrectedEntries(null)).toEqual({});
    expect(readCorrectedEntries([])).toEqual({});
  });
});

describe("getFullPatientRecordExport (S05b-d)", () => {
  it("includes the patient's superseded values so the copy is complete", async () => {
    const record = await getFullPatientRecordExport(fakeClient({ data: { patient_allergies: [{ id: "old", correction_status: "corrected" }] }, error: null }), "p1");
    expect(record.correctedEntries.patient_allergies).toEqual([{ id: "old", correction_status: "corrected" }]);
    expect(record.allergies).toEqual([]);
    expect(record.correctedEntriesAvailable).toBe(true);
  });
  it("fails the export when the history cannot be read, never silently omits it", async () => {
    await expect(getFullPatientRecordExport(fakeClient({ data: null, error: { message: "boom", code: "XX000" } }), "p1")).rejects.toEqual({ message: "boom", code: "XX000" });
  });
  it("still exports the rest of the record before the migration is applied (function missing)", async () => {
    const record = await getFullPatientRecordExport(fakeClient({ data: null, error: { message: "no function", code: "PGRST202" } }), "p1");
    expect(record.correctedEntries).toEqual({});
    expect(record.correctedEntriesAvailable).toBe(false);
    expect(record.patient.id).toBe("p1");
  });
  it("treats 42883 from inside an existing function as a real failure", async () => {
    await expect(getFullPatientRecordExport(fakeClient({ data: null, error: { message: "function missing inside", code: "42883" } }), "p1")).rejects.toEqual({ message: "function missing inside", code: "42883" });
  });
});
