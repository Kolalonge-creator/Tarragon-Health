import { en, pcm } from "@tarragon/i18n";
import { checkoutErrorKey, keepsRetryKey, orderStateKey, parseCatalogue, parseCheckout, parseMembership, parseOrders, parseVerify } from "./parse";

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { loadCatalogue, loadMembership, loadMyOrders, startCheckout, verifyOrder } from "./api";

const item = { code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["a", 3, "b"], amount_kobo: 10_000_000 };

describe("parsing", () => {
  it("keeps good catalogue rows, drops bad ones, and keeps only string copy keys", () => {
    const rows = parseCatalogue([item, { ...item, code: "BAD" }, { ...item, amount_kobo: 0 }, { ...item, amount_kobo: 1.5 }, { ...item, kind: "wallet" }, { ...item, name_key: 3 }, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.includedKeys).toEqual(["a", "b"]);
    expect(parseCatalogue("x")).toEqual([]);
  });
  it("parses orders and memberships and falls back safely", () => {
    const o = { order_id: "o1", state: "paid", amount_kobo: 500_000, total_kobo: 500_150, name_key: "k", created_at: "2026-10-06T10:00:00Z", paid_at: null };
    expect(parseOrders([o, { ...o, state: "teleported" }, { ...o, amount_kobo: -1 }, { ...o, amount_kobo: 0 }, 3])).toHaveLength(1);
    expect(parseOrders([{ ...o, total_kobo: null, paid_at: "x" }])[0]).toMatchObject({ totalKobo: null, paidAt: "x" });
    expect(parseOrders(null)).toEqual([]);
    expect(parseMembership({ is_member: true, ends_at: "2027-01-01T00:00:00Z" })).toEqual({ isMember: true, endsAt: "2027-01-01T00:00:00Z" });
    expect(parseMembership({ is_member: true })).toEqual({ isMember: true, endsAt: null });
    expect(parseMembership({ is_member: "yes" })).toEqual({ isMember: false, endsAt: null });
  });
  it("opens only an https checkout link", () => {
    expect(parseCheckout({ reference: "tho_x", checkout_url: "https://checkout.paystack.com/a" })).toEqual({ reference: "tho_x", checkoutUrl: "https://checkout.paystack.com/a" });
    expect(parseCheckout({ reference: "tho_x", checkout_url: "http://evil.example" })).toBeNull();
    expect(parseCheckout({ reference: "tho_x", checkout_url: "javascript:alert(1)" })).toBeNull();
    expect(parseCheckout(null)).toBeNull();
    expect(parseVerify({ state: "paid", outcome: "paid" })).toEqual({ state: "paid", outcome: "paid" });
    expect(parseVerify({ state: "weird", outcome: "x" })).toBeNull();
    expect(parseVerify(3)).toBeNull();
  });
  it("every error code and state has copy in both languages; refusals drop the retry key, network failures keep it", () => {
    for (const c of ["checkout_not_open", "no_capacity", "already_member", "unknown", "payment_unavailable", "surprise"]) {
      const k = checkoutErrorKey(c);
      expect(en[k].length).toBeGreaterThan(0);
      expect(pcm[k].length).toBeGreaterThan(0);
    }
    expect(checkoutErrorKey("surprise")).toBe("shop.error.unknown");
    expect(checkoutErrorKey(1)).toBe("shop.error.unknown");
    expect(keepsRetryKey("payment_unavailable")).toBe(true);
    expect(keepsRetryKey("unknown")).toBe(true);
    expect(keepsRetryKey("no_capacity")).toBe(false);
    for (const s of ["created", "paid", "failed", "refunded", "cancelled"] as const) expect(en[orderStateKey(s)].length).toBeGreaterThan(0);
  });
});

describe("api", () => {
  beforeEach(() => { mockInvoke.mockReset(); mockRpc.mockReset(); });
  it("sends only the item code and the retry key to checkout, never an amount", async () => {
    mockInvoke.mockResolvedValue({ data: { reference: "tho_x", checkout_url: "https://checkout.paystack.com/a" }, error: null });
    expect(await startCheckout("membership_annual", "k1")).toEqual({ ok: true, reference: "tho_x", checkoutUrl: "https://checkout.paystack.com/a" });
    expect(mockInvoke).toHaveBeenCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k1" } });
  });
  it("reads the stable error code from a failed call, and treats a strange success as unknown", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { context: { clone: () => ({ json: async () => ({ error: "no_capacity" }) }) } } });
    expect(await startCheckout("x_item", "k")).toEqual({ ok: false, code: "no_capacity" });
    mockInvoke.mockResolvedValue({ data: null, error: { context: { clone: () => ({ json: async () => { throw new Error("not json"); } }) } } });
    expect(await startCheckout("x_item", "k")).toEqual({ ok: false, code: "unknown" });
    mockInvoke.mockResolvedValue({ data: null, error: new Error("offline") });
    expect(await startCheckout("x_item", "k")).toEqual({ ok: false, code: "unknown" });
    mockInvoke.mockResolvedValue({ data: { nope: 1 }, error: null });
    expect(await startCheckout("x_item", "k")).toEqual({ ok: false, code: "unknown" });
  });
  it("verifies through the server and reads nothing from the app's own return", async () => {
    mockInvoke.mockResolvedValue({ data: { state: "paid", outcome: "paid" }, error: null });
    expect(await verifyOrder("tho_x")).toEqual({ state: "paid", outcome: "paid" });
    expect(mockInvoke).toHaveBeenCalledWith("order-verify", { body: { reference: "tho_x" } });
    mockInvoke.mockResolvedValue({ data: null, error: new Error("x") });
    expect(await verifyOrder("tho_x")).toBeNull();
  });
  it("loads through the database functions and reports an error as a value", async () => {
    mockRpc.mockResolvedValue({ data: [item], error: null });
    expect(await loadCatalogue()).toMatchObject({ ok: true });
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await loadMyOrders()).toEqual({ ok: true, data: [] });
    mockRpc.mockResolvedValue({ data: { is_member: false }, error: null });
    expect(await loadMembership()).toEqual({ ok: true, data: { isMember: false, endsAt: null } });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadCatalogue()).toEqual({ ok: false, error: "boom" });
    expect(await loadMyOrders()).toEqual({ ok: false, error: "boom" });
    expect(await loadMembership()).toEqual({ ok: false, error: "boom" });
  });
});
