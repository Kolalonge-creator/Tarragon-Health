import {
  loadBrandMap,
  loadDuplicateIngredientCheckState,
  loadInteractionRules,
  loadPackNumber,
  loadPharmacyCollectionOpen,
  loadSupporterTodaysDoses,
  setNafdacNumber,
} from "./medicine-safety";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, jest.Mock> = {};
  for (const m of ["select", "eq", "not"]) c[m] = jest.fn(() => c);
  c.limit = jest.fn(() => Promise.resolve(result));
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  return c;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe("switches fail soft and say so", () => {
  it("open, closed, and unknown are three different answers", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await loadDuplicateIngredientCheckState()).toBe("open");
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await loadDuplicateIngredientCheckState()).toBe("closed");
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadDuplicateIngredientCheckState()).toBe("unknown");
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadDuplicateIngredientCheckState()).toBe("unknown");
  });
  it("the S28 flow: null (not false) when it cannot be read, so no dead link is offered", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await loadPharmacyCollectionOpen()).toBe(true);
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await loadPharmacyCollectionOpen()).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadPharmacyCollectionOpen()).toBeNull();
  });
});

describe("interaction rules", () => {
  const rule = { code: "r1", ingredientA: "exampleone", ingredientB: "exampletwo", severity: "caution", source: "https://example.org/s" };
  it("returns the signed rules, [] when closed, and null when the answer cannot be trusted", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok", rules: [rule] }, error: null });
    expect(await loadInteractionRules()).toEqual([rule]);
    mockRpc.mockResolvedValueOnce({ data: { status: "closed" }, error: null });
    expect(await loadInteractionRules()).toEqual([]);
    mockRpc.mockResolvedValueOnce({ data: { status: "ok", rules: [{ code: "x" }] }, error: null });
    expect(await loadInteractionRules()).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: { status: "surprise" }, error: null });
    expect(await loadInteractionRules()).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadInteractionRules()).toBeNull();
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadInteractionRules()).toBeNull();
  });
});

describe("brand map", () => {
  it("asks only for active reviewed rows and maps them; a failure is an empty list", async () => {
    const c = chain({
      data: [{ id: "b1", brand_name: "Examplebrand", ingredients: ["exampleone"], source_citation: "https://e.org", reviewed_by: "u", reviewer_name: "A", reviewed_at: "2026-10-20T00:00:00Z", is_active: true }],
      error: null,
    });
    mockFrom.mockReturnValue(c);
    const rows = await loadBrandMap();
    expect(rows).toEqual([{ id: "b1", brandName: "Examplebrand", ingredients: ["exampleone"], sourceCitation: "https://e.org", reviewedBy: "u", reviewerName: "A", reviewedAt: "2026-10-20T00:00:00Z", isActive: true }]);
    expect(c.eq).toHaveBeenCalledWith("is_active", true);
    mockFrom.mockReturnValue(chain({ data: null, error: { message: "x" } }));
    expect(await loadBrandMap()).toEqual([]);
    mockFrom.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await loadBrandMap()).toEqual([]);
  });
});

describe("NAFDAC number note", () => {
  it("stores through the function and reports a failure instead of hiding it", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    expect(await setNafdacNumber("m1", "A4-1234")).toEqual({});
    expect(mockRpc).toHaveBeenCalledWith("set_medication_nafdac_number", { p_medication: "m1", p_number: "A4-1234" });
    mockRpc.mockResolvedValueOnce({ error: { message: "nope" } });
    expect(await setNafdacNumber("m1", "A4-1234")).toEqual({ error: "nope" });
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    expect(await setNafdacNumber("m1", "A4-1234")).toEqual({ error: "offline" });
  });
  it("reads the noted number, or null", async () => {
    mockFrom.mockReturnValue(chain({ data: { nafdac_number: "A4-1234" }, error: null }));
    expect(await loadPackNumber("m1")).toBe("A4-1234");
    mockFrom.mockReturnValue(chain({ data: null, error: null }));
    expect(await loadPackNumber("m1")).toBeNull();
    mockFrom.mockReturnValue(chain({ data: null, error: { message: "x" } }));
    expect(await loadPackNumber("m1")).toBeNull();
  });
});

describe("supporter's today's doses", () => {
  it("a failed read is unreadable, never an empty list", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "not_shared" }, error: null });
    expect(await loadSupporterTodaysDoses("p1")).toEqual({ status: "not_shared" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadSupporterTodaysDoses("p1")).toEqual({ status: "unreadable" });
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadSupporterTodaysDoses("p1")).toEqual({ status: "unreadable" });
  });
});
