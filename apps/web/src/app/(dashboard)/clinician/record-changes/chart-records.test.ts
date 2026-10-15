/**
 * S05b-e: the current record beside a request comes from the audited chart reader (staff cannot read patient_allergies
 * directly). A refused or malformed answer is "could not load", never an empty list that would read as "the entry is gone".
 */
import { CHART_READ_REASON, loadCurrentRecords, parseChartAllergies, parseChartConditions } from "./chart-records";

const OK = {
  status: "ok",
  denied: [],
  sections: {
    allergies: [
      { id: "a1", substance: "Peanut", reaction: "Hives", severity: "moderate", source: "patient", noted_at: "2026-01-01" },
      { id: "a2", substance: "Latex", reaction: null, severity: null, source: "clinician", noted_at: null },
    ],
  },
};

describe("parseChartAllergies", () => {
  it("keys the allergies by id and renames substance to allergen", () => {
    const map = parseChartAllergies(OK);
    expect(map?.get("a1")).toEqual({
      allergen: "Peanut",
      reaction: "Hives",
      severity: "moderate",
      source: "patient",
      noted_at: "2026-01-01",
    });
    expect(map?.get("a2")?.severity).toBeNull();
  });

  it("returns null (could not load) for a denied answer, a missing section or a shape it does not know", () => {
    expect(parseChartAllergies({ status: "denied", sections: {}, denied: ["allergies"] })).toBeNull();
    expect(parseChartAllergies({ status: "ok", sections: {} })).toBeNull();
    expect(parseChartAllergies(null)).toBeNull();
    expect(parseChartAllergies({ status: "ok", sections: { allergies: [{ id: 1 }] } })).toBeNull();
  });

  it("treats a loaded, empty list as loaded (the entry really is gone)", () => {
    expect(parseChartAllergies({ status: "ok", sections: { allergies: [] } })?.size).toBe(0);
  });
});

const OK_CONDITIONS = {
  status: "ok",
  denied: [],
  sections: {
    conditions: [
      { id: "c1", display: "Gout", code: "M10", status: "active", source: "patient", date_identified: "2024-05-01" },
      { id: "c2", display: "Migraine", code: null, status: "suspected", source: "patient", date_identified: null },
    ],
  },
};

describe("parseChartConditions", () => {
  it("keys the conditions by id and renames display and code", () => {
    const map = parseChartConditions(OK_CONDITIONS);
    expect(map?.get("c1")).toEqual({
      condition_name: "Gout",
      icd10_code: "M10",
      status: "active",
      source: "patient",
      date_identified: "2024-05-01",
    });
    expect(map?.get("c2")?.icd10_code).toBeNull();
  });

  it("returns null (could not load) for a denied answer, a missing section or a shape it does not know", () => {
    expect(parseChartConditions({ status: "denied", sections: {}, denied: ["conditions"] })).toBeNull();
    expect(parseChartConditions({ status: "ok", sections: {} })).toBeNull();
    expect(parseChartConditions({ status: "ok", sections: { allergies: [] } })).toBeNull();
    expect(parseChartConditions(null)).toBeNull();
    expect(parseChartConditions({ status: "ok", sections: { conditions: [{ id: 1 }] } })).toBeNull();
  });

  it("treats a loaded, empty list as loaded (the entry really is gone)", () => {
    expect(parseChartConditions({ status: "ok", sections: { conditions: [] } })?.size).toBe(0);
  });
});

describe("loadCurrentRecords", () => {
  it("reads once per distinct patient with a reason and only the sections that patient's requests need", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...OK, sections: { ...OK.sections, ...OK_CONDITIONS.sections } }, error: null });
    const result = await loadCurrentRecords({ rpc }, [
      { patientId: "p1", kind: "allergy" },
      { patientId: "p1", kind: "allergy" },
      { patientId: "p1", kind: "condition" },
      { patientId: "p2", kind: "condition" },
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("read_patient_chart_audited", {
      p_patient: "p1",
      p_sections: ["allergies", "conditions"],
      p_reason: CHART_READ_REASON,
    });
    expect(rpc).toHaveBeenCalledWith("read_patient_chart_audited", {
      p_patient: "p2",
      p_sections: ["conditions"],
      p_reason: CHART_READ_REASON,
    });
    expect(CHART_READ_REASON.length).toBeGreaterThanOrEqual(10);
    expect(result.byPatient.get("p1")?.allergies?.get("a1")?.allergen).toBe("Peanut");
    expect(result.byPatient.get("p1")?.conditions?.get("c1")?.condition_name).toBe("Gout");
    expect(result.byPatient.get("p2")?.allergies).toBeNull();
    expect(result.failed).toEqual([]);
  });

  it("lists a patient whose read errored or was denied as failed, with the unavailable section null", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: OK, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not authorised" } })
      .mockResolvedValueOnce({ data: { status: "denied", sections: {}, denied: ["allergies"] }, error: null });
    const result = await loadCurrentRecords({ rpc }, [
      { patientId: "p1", kind: "allergy" },
      { patientId: "p2", kind: "allergy" },
      { patientId: "p3", kind: "allergy" },
    ]);
    expect(result.failed.sort()).toEqual(["p2", "p3"]);
    expect(result.byPatient.get("p1")?.allergies?.size).toBe(2);
    expect(result.byPatient.get("p2")?.allergies).toBeNull();
  });

  it("fails a patient when one of the sections she needs is missing from an otherwise good answer", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: OK, error: null });
    const result = await loadCurrentRecords({ rpc }, [
      { patientId: "p1", kind: "allergy" },
      { patientId: "p1", kind: "condition" },
    ]);
    expect(result.failed).toEqual(["p1"]);
    expect(result.byPatient.get("p1")?.allergies?.size).toBe(2);
    expect(result.byPatient.get("p1")?.conditions).toBeNull();
  });
});
