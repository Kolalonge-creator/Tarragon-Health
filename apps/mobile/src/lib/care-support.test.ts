import { createNavigationRequest } from "./care-support";
import { supabase } from "./supabase";
import * as careSupport from "./care-support";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;

/**
 * S22: patients can no longer read async_consults or clinical_encounter_notes
 * directly, so the old direct-read helpers are gone. This pins that nothing in
 * this module reaches for the dead table again; the written-question flow lives
 * in ./written-questions/ and ./patient-notes.ts.
 */
describe("care-support after S22", () => {
  it("no longer exports the old direct async_consults helpers", () => {
    expect("loadMyAsyncConsults" in careSupport).toBe(false);
    expect("submitAsyncConsult" in careSupport).toBe(false);
  });

  it("createNavigationRequest rejects a too-short description without calling the database", async () => {
    const result = await createNavigationRequest({
      patientId: "p1",
      category: "appointment",
      description: "short",
      isComplaint: false,
    });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("createNavigationRequest goes through the RPC, never a table insert", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const result = await createNavigationRequest({
      patientId: "p1",
      category: "pharmacy",
      description: "I need help finding a pharmacy",
      isComplaint: false,
    });
    expect(result.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("create_navigation_request", expect.objectContaining({ p_patient_id: "p1" }));
  });
});
