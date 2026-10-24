import { en } from "@tarragon/i18n";

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { HMO_RESULT_KEYS, hmoErrorKey, isPlausibleMemberNumber, loadHmoPlans, loadMyHmoChecks, parseHmoChecks, parseHmoPlans, parseHmoReply, requestHmoCheck } from "./hmo";

const check = { check_id: "c1", hmo_name: "Avon", result: "pending_manual", checked_at: "2026-10-20T10:00:00Z", decided_at: null };

describe("hmo parsing", () => {
  it("keeps good rows and drops bad ones; a bad reply is none", () => {
    expect(parseHmoPlans([{ hmo_id: "h1", name: "Avon" }, { hmo_id: 3, name: "x" }, null])).toEqual([{ hmoId: "h1", name: "Avon" }]);
    expect(parseHmoPlans("x")).toEqual([]);
    expect(parseHmoChecks([check, { ...check, result: "maybe" }, { ...check, check_id: 2 }])).toHaveLength(1);
    expect(parseHmoChecks([{ ...check, result: "eligible", decided_at: "2026-10-21T00:00:00Z" }])[0]).toMatchObject({ result: "eligible", decidedAt: "2026-10-21T00:00:00Z" });
    expect(parseHmoReply({ check_id: "c", result: "eligible" })).toEqual({ checkId: "c", result: "eligible" });
    expect(parseHmoReply({ check_id: "c", result: "yes" })).toBeNull();
    expect(parseHmoReply(null)).toBeNull();
  });
  it("a row never carries a member number even if the server sent one", () => {
    const row = parseHmoChecks([{ ...check, member_number: "SECRET123" }])[0]!;
    expect(JSON.stringify(row)).not.toContain("SECRET123");
  });
  it("has copy for every result and error, and unknown codes get the generic one", () => {
    for (const k of Object.values(HMO_RESULT_KEYS)) expect(en[k].length).toBeGreaterThan(0);
    for (const c of ["hmo_not_available", "hmo_check_rate_limited", "sponsor_payment_not_open", "member_number_invalid", "hmo_not_configured", "zzz"]) expect(en[hmoErrorKey(c)].length).toBeGreaterThan(0);
    expect(hmoErrorKey("zzz")).toBe("hmo.error.unknown");
    expect(hmoErrorKey(5)).toBe("hmo.error.unknown");
  });
  it("checks the member number shape", () => {
    expect(isPlausibleMemberNumber("AV/12345/01")).toBe(true);
    expect(isPlausibleMemberNumber("ab")).toBe(false);
    expect(isPlausibleMemberNumber("<script>")).toBe(false);
  });
});

describe("hmo api", () => {
  beforeEach(() => { mockInvoke.mockReset(); mockRpc.mockReset(); });
  it("lists plans and checks via the RPCs; an error fails closed (no card)", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ hmo_id: "h1", name: "Avon" }], error: null });
    expect(await loadHmoPlans()).toEqual({ ok: true, data: [{ hmoId: "h1", name: "Avon" }] });
    expect(mockRpc).toHaveBeenCalledWith("available_hmos");
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await loadHmoPlans()).toEqual({ ok: false, error: "boom" });
    mockRpc.mockResolvedValueOnce({ data: [check], error: null });
    expect((await loadMyHmoChecks()).ok).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("my_hmo_eligibility");
  });
  it("sends the trimmed number once to the function and returns only the result", async () => {
    mockInvoke.mockResolvedValue({ data: { check_id: "c1", result: "pending_manual" }, error: null });
    expect(await requestHmoCheck("h1", " AV/123 ")).toEqual({ ok: true, result: "pending_manual" });
    expect(mockInvoke).toHaveBeenCalledWith("hmo-eligibility", { body: { hmo_id: "h1", member_number: "AV/123" } });
  });
  it("maps a refusal code from the function body and treats a malformed reply as unknown", async () => {
    const res = new Response(JSON.stringify({ error: "hmo_check_rate_limited" }), { status: 429 });
    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: res } });
    expect(await requestHmoCheck("h1", "AV123")).toEqual({ ok: false, code: "hmo_check_rate_limited" });
    mockInvoke.mockResolvedValueOnce({ data: { nope: 1 }, error: null });
    expect(await requestHmoCheck("h1", "AV123")).toEqual({ ok: false, code: "unknown" });
  });
});
