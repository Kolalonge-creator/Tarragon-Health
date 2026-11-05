const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { getProposedConfig } from "@tarragon/shared";
import { findPlacesForPatientAction, findTestsAction, loadBranchProfile } from "./patient-search";

const C = "11111111-1111-4111-8111-111111111111";
beforeEach(() => rpc.mockReset());

describe("findTestsAction", () => {
  it("passes the versioned threshold and reports a clarifying group", async () => {
    rpc.mockResolvedValue({ data: [
      { concept_id: C, display: "Pelvic ultrasound", patient_description: null, investigation_category: "ultrasound", matched_on: "clarify", clarifies_concept_id: C, clarifies_display: "Ultrasound" },
    ], error: null });
    const r = await findTestsAction("scan");
    expect(rpc).toHaveBeenCalledWith("search_investigations", expect.objectContaining({
      p_text: "scan", p_min_score: getProposedConfig<{ min_score: number }>("directory.investigation_search").value.min_score,
    }));
    expect(r).toEqual(expect.objectContaining({ ok: true, clarifying: "Ultrasound" }));
  });
  it("a database error is a failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await findTestsAction("hba1c")).toEqual({ ok: false });
  });
});

describe("findPlacesForPatientAction", () => {
  it("shows unconfirmed branches (labelled, below) and searches by point with a configured radius", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await findPlacesForPatientAction({ conceptId: C, where: { lat: 6.43, lng: 3.42, radiusKm: 20 } });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({ p_lat: 6.43, p_radius_km: 20, p_include_unconfirmed: true }));
  });
});

describe("loadBranchProfile", () => {
  it("a closed directory is reported as closed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect(await loadBranchProfile(C)).toEqual({ ok: false, closed: true });
  });
  it("a bad id is simply not found", async () => {
    expect(await loadBranchProfile("nope")).toEqual({ ok: true, profile: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});
