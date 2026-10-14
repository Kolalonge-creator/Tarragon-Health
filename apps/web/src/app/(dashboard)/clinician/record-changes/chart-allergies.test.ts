/**
 * S05b-e: the current record beside a request comes from the audited chart reader (staff cannot read patient_allergies
 * directly). A refused or malformed answer is "could not load", never an empty list that would read as "the entry is gone".
 */
import { CHART_READ_REASON, loadCurrentAllergies, parseChartAllergies } from "./chart-allergies";

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

describe("loadCurrentAllergies", () => {
  it("reads once per distinct patient with a reason and the allergies section only", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: OK, error: null });
    const result = await loadCurrentAllergies({ rpc }, ["p1", "p1", "p2"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("read_patient_chart_audited", {
      p_patient: "p1",
      p_sections: ["allergies"],
      p_reason: CHART_READ_REASON,
    });
    expect(CHART_READ_REASON.length).toBeGreaterThanOrEqual(10);
    expect([...result.byPatient.keys()].sort()).toEqual(["p1", "p2"]);
    expect(result.failed).toEqual([]);
  });

  it("lists a patient whose read errored or was denied as failed", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: OK, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not authorised" } })
      .mockResolvedValueOnce({ data: { status: "denied", sections: {}, denied: ["allergies"] }, error: null });
    const result = await loadCurrentAllergies({ rpc }, ["p1", "p2", "p3"]);
    expect([...result.byPatient.keys()]).toEqual(["p1"]);
    expect(result.failed.sort()).toEqual(["p2", "p3"]);
  });
});
