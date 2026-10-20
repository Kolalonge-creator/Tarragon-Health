/**
 * HMO / NHIA cover on the phone's emergency card (S09y): it is read into the card only when filled, saved only through the one database function after
 * the same validation the function applies, and it is cached with the rest of the card for offline use.
 */
import { loadEmergencyFacts, saveEmergencyCoverage } from "./emergency";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn().mockResolvedValue(undefined) }));

const mockFrom = supabase.from as unknown as jest.Mock;
const rpc = supabase.rpc as unknown as jest.Mock;

function table(data: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown }) => unknown) => Promise.resolve({ data }).then(resolve),
    maybeSingle: () => Promise.resolve({ data }),
  };
  for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
  return builder;
}
function seed(coverage: unknown) {
  const tables: Record<string, unknown> = {
    profiles: { full_name: "Ada Obi" },
    patient_allergies: [],
    care_plans: [],
    patient_blood_profile: null,
    medications: [],
    emergency_card_coverage: coverage,
  };
  mockFrom.mockImplementation((name: string) => table(tables[name]));
}

beforeEach(() => {
  rpc.mockReset();
  mockFrom.mockReset();
});

describe("cover on the card", () => {
  it("is on the card only when the person filled it in, and is always patient entered", async () => {
    seed({ scheme: "nhia", member_number: "NHIA-22", plan_name: null });
    expect((await loadEmergencyFacts("p1")).coverage).toEqual({ scheme: "nhia", member_number: "NHIA-22", plan_name: null, provenance: "patient_entered" });
  });
  it("is absent when nothing is saved, or the row is empty or unknown", async () => {
    for (const row of [null, undefined, { scheme: "hmo", member_number: " ", plan_name: "" }, { scheme: "visa", member_number: "ABC123" }]) {
      seed(row);
      expect((await loadEmergencyFacts("p1")).coverage).toBeNull();
    }
  });
});

describe("a failed cover read", () => {
  it("is unknown (undefined), never 'none saved' (null), so the form is not offered over real cover", async () => {
    const tables: Record<string, unknown> = { profiles: { full_name: "Ada Obi" }, patient_allergies: [], care_plans: [], patient_blood_profile: null, medications: [] };
    mockFrom.mockImplementation((name: string) => {
      const b = table(tables[name]);
      if (name !== "emergency_card_coverage") return b;
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) };
    });
    expect((await loadEmergencyFacts("p1")).coverage).toBeUndefined();
  });
});

describe("saveEmergencyCoverage", () => {
  it("saves through the database function only", async () => {
    rpc.mockResolvedValue({ data: { status: "saved" }, error: null });
    const r = await saveEmergencyCoverage({ scheme: "hmo", memberNumber: " REL/12345 ", planName: "Reliance Gold" });
    expect(rpc).toHaveBeenCalledWith("set_emergency_card_coverage", { p_scheme: "hmo", p_member_number: "REL/12345", p_plan_name: "Reliance Gold" });
    expect(r).toEqual({ ok: true, removed: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it("both blank removes it", async () => {
    rpc.mockResolvedValue({ data: { status: "cleared" }, error: null });
    expect(await saveEmergencyCoverage({ scheme: "hmo", memberNumber: "", planName: "  " })).toEqual({ ok: true, removed: true });
  });
  it("never sends a bad value, and says which field is wrong", async () => {
    expect(await saveEmergencyCoverage({ scheme: "hmo", memberNumber: "12; drop", planName: "" })).toEqual({ ok: false, field: "member_number" });
    expect(await saveEmergencyCoverage({ scheme: "hmo", memberNumber: "", planName: "<b>x</b>" })).toEqual({ ok: false, field: "plan_name" });
    expect(await saveEmergencyCoverage({ scheme: "visa", memberNumber: "ABC123", planName: "" })).toEqual({ ok: false, field: "scheme" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a database error is a failure, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await saveEmergencyCoverage({ scheme: "hmo", memberNumber: "ABC123", planName: "" })).toEqual({ ok: false, field: "save" });
  });
});
