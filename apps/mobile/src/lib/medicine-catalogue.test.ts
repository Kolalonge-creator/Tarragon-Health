import { INTERACTION_DATASET_HASH } from "@tarragon/medicines";
import { loadRefillPharmacy, addSideEffectNote, __resetCatalogueCache, catalogueFromRows, loadInteractionCheckState, loadMedicineCatalogue } from "./medicine-catalogue";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;

const ROW = { id: "c1", brand_name: "Norvasc", generic_name: "Amlodipine", strength: null, form: null, nafdac_number: null, is_verified: false };

function selectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => Promise.resolve(result));
  return chain;
}

beforeEach(() => __resetCatalogueCache());

describe("medicine catalogue on the phone (8.2)", () => {
  it("maps rows and never invents a NAFDAC number or a verified flag", () => {
    expect(catalogueFromRows([ROW])).toEqual([
      { id: "c1", brandName: "Norvasc", genericName: "Amlodipine", strength: null, form: null, nafdacNumber: null, isVerified: false },
    ]);
  });

  it("fetches the active list once, then serves it from memory", async () => {
    const chain = selectChain({ data: [ROW], error: null });
    mockFrom.mockReturnValue(chain);
    const first = await loadMedicineCatalogue(1_000);
    const second = await loadMedicineCatalogue(2_000);
    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("a failed fetch is an empty list, never a throw (typing a name by hand still works)", async () => {
    mockFrom.mockReturnValue(selectChain({ data: null, error: { message: "offline" } }));
    await expect(loadMedicineCatalogue(5_000_000_000_000)).resolves.toEqual([]);
    mockFrom.mockImplementation(() => {
      throw new Error("network");
    });
    __resetCatalogueCache();
    await expect(loadMedicineCatalogue(6_000_000_000_000)).resolves.toEqual([]);
  });
});

describe("interaction check guard (INV-14)", () => {
  function signedChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => Promise.resolve(result));
    return chain;
  }

  it("is open only when the guard is on AND the signed dataset is the one this build runs", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    mockFrom.mockReturnValueOnce(signedChain({ data: [{ content_hash: INTERACTION_DATASET_HASH }], error: null }));
    await expect(loadInteractionCheckState()).resolves.toBe("open");
    expect(mockRpc).toHaveBeenCalledWith("go_live_guard_is_open", { p_key: "interaction_check_enabled" });
  });
  it("stays closed when the signed dataset is a different one (a rule changed after the sign-off)", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    mockFrom.mockReturnValueOnce(signedChain({ data: [{ content_hash: "0".repeat(64) }], error: null }));
    await expect(loadInteractionCheckState()).resolves.toBe("closed");
  });
  it("stays closed when no dataset is signed, or the read fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    mockFrom.mockReturnValueOnce(signedChain({ data: [], error: null }));
    await expect(loadInteractionCheckState()).resolves.toBe("closed");
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    mockFrom.mockReturnValueOnce(signedChain({ data: null, error: { message: "x" } }));
    await expect(loadInteractionCheckState()).resolves.toBe("unknown");
  });
  it("is closed on false or null, and UNKNOWN (never open) on an error or a thrown call", async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(loadInteractionCheckState()).resolves.toBe("closed");
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(loadInteractionCheckState()).resolves.toBe("closed");
    mockRpc.mockResolvedValueOnce({ data: true, error: { message: "x" } });
    await expect(loadInteractionCheckState()).resolves.toBe("unknown");
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    await expect(loadInteractionCheckState()).resolves.toBe("unknown");
  });
  it("a slow connection reads as unknown instead of holding up the add", async () => {
    mockRpc.mockReturnValueOnce(new Promise(() => undefined));
    await expect(loadInteractionCheckState(20)).resolves.toBe("unknown");
  });
});

describe("side-effect notes (8.7)", () => {
  it("sends only the medicine and the words; the database sets who and where", async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await expect(addSideEffectNote("m1", "  Felt dizzy  ")).resolves.toEqual({});
    expect(mockFrom).toHaveBeenCalledWith("medication_side_effect_notes");
    expect(insert).toHaveBeenCalledWith({ medication_id: "m1", note: "Felt dizzy" });
  });
  it("refuses an empty note without calling the database and reports errors", async () => {
    await expect(addSideEffectNote("m1", "   ")).resolves.toEqual({ error: "empty" });
    expect(mockFrom).not.toHaveBeenCalled();
    mockFrom.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: { message: "denied" } }) });
    await expect(addSideEffectNote("m1", "x")).resolves.toEqual({ error: "denied" });
    mockFrom.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(addSideEffectNote("m1", "x")).resolves.toEqual({ error: "boom" });
  });
});

describe("refill pharmacy (8.10)", () => {
  it("returns the chosen pharmacy, or null for none, an error or a malformed answer", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ partner_name: "Pharmacy A", location_name: "Lekki", address: "1 Road" }], error: null });
    await expect(loadRefillPharmacy("m1")).resolves.toEqual({ partnerName: "Pharmacy A", locationName: "Lekki", address: "1 Road" });
    expect(mockRpc).toHaveBeenCalledWith("medication_refill_pharmacy", { p_medication: "m1" });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(loadRefillPharmacy("m1")).resolves.toBeNull();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(loadRefillPharmacy("m1")).resolves.toBeNull();
    mockRpc.mockResolvedValueOnce({ data: [{}], error: null });
    await expect(loadRefillPharmacy("m1")).resolves.toBeNull();
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    await expect(loadRefillPharmacy("m1")).resolves.toBeNull();
  });
});
