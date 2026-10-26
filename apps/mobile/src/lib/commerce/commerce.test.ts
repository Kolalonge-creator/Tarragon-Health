import { en } from "@tarragon/i18n";
import { arrangeItems } from "@tarragon/commerce";
import { checkoutErrorKey, keepsRetryKey, orderStateKey, parseCatalogue, parseCheckout, parseCovered, parseMembership, parseOrders, parsePlusStates, parseVerify } from "./parse";

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { loadCatalogue, loadMembership, loadMyOrders, loadNotIncluded, loadPlusStates, loadPriceChangeNotices, startCheckout, verifyOrder } from "./api";

const item = { code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["a", 3, "b"], amount_kobo: 12_000_000 };

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
    expect(parseMembership({ is_member: true, ends_at: "2027-01-01T00:00:00Z", tier: "evergreen" })).toEqual({ isMember: true, endsAt: "2027-01-01T00:00:00Z", tier: "evergreen" });
    expect(parseMembership({ is_member: true, tier: "gold" })).toEqual({ isMember: true, endsAt: null });
    expect(parseMembership({ is_member: "yes" })).toEqual({ isMember: false, endsAt: null });
    // in the grace the person keeps Member access but the screen must let them renew, so it is not treated as a current Member
    expect(parseMembership({ is_member: true, in_grace: true, ends_at: "2026-12-01T00:00:00Z", grace_ends_at: "2026-12-15T00:00:00Z" })).toEqual({ isMember: false, endsAt: null, graceEndsAt: "2026-12-15T00:00:00Z" });
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
  it("every error code and state has copy; refusals drop the retry key, network failures keep it", () => {
    for (const c of ["checkout_not_open", "no_capacity", "already_member", "unknown", "payment_unavailable", "surprise"]) {
      const k = checkoutErrorKey(c);
      expect(en[k].length).toBeGreaterThan(0);
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
  it("S29: sends the beneficiary when paying for a loved one, and only then", async () => {
    mockInvoke.mockResolvedValue({ data: { reference: "tho_x", checkout_url: "https://checkout.paystack.com/a" }, error: null });
    await startCheckout("membership_annual", "k1", "p-9");
    expect(mockInvoke).toHaveBeenLastCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k1", beneficiary: "p-9" } });
    await startCheckout("membership_annual", "k2", undefined);
    expect(mockInvoke).toHaveBeenLastCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k2" } });
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

describe("S71 additions", () => {
  it("a sponsor-covered order of 0 is a real row; a bare 0 is still a bad row", () => {
    const o = { order_id: "o1", state: "paid", amount_kobo: 0, total_kobo: 0, name_key: "k", created_at: "2026-10-06T10:00:00Z", paid_at: "2026-10-06T10:00:00Z" };
    expect(parseOrders([o])).toHaveLength(0);
    const rows = parseOrders([{ ...o, sponsor_share_kobo: 500_000, sponsor_name: "Acme Ltd" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sponsorShareKobo: 500_000, sponsorName: "Acme Ltd" });
  });
  it("reads a covered checkout reply, which has no link", () => {
    expect(parseCovered({ covered: true, reference: "spo_x", sponsor_name: "Acme Ltd" })).toEqual({ reference: "spo_x", sponsorName: "Acme Ltd" });
    expect(parseCovered({ reference: "spo_x" })).toBeNull();
    expect(parseCheckout({ covered: true, reference: "spo_x" })).toBeNull();
  });
  it("maps the sponsor refusals to messages", () => {
    expect(checkoutErrorKey("sponsor_budget_exhausted")).toBe("shop.error.sponsor_budget_exhausted");
    expect(checkoutErrorKey("sponsor_payment_not_open")).toBe("shop.error.sponsor_payment_not_open");
    expect(checkoutErrorKey("quote_changed")).toBe("shop.error.quote_changed");
  });
  it("accepts the home_kit kind", () => {
    expect(parseCatalogue([{ ...item, kind: "home_kit", code: "home_kit_sample" }])).toHaveLength(1);
  });
});

// S72 ----------------------------------------------------------------------------------------------------------------------------
import { createPaymentRequest, cancelPaymentRequest, loadEntitlements, loadPaymentRequests, loadQuote, requestRefund } from "./api";

describe("S72 api: entitlements, quote with points, refunds, payment requests", () => {
  beforeEach(() => { mockRpc.mockReset(); mockInvoke.mockReset(); });

  it("sends the points wish and the total the person was shown with the checkout, and nothing else", async () => {
    mockInvoke.mockResolvedValue({ data: { order_id: "o1", reference: "tho_x", amount_kobo: 475_000, checkout_url: "https://checkout.example/x" }, error: null });
    await startCheckout("proof_consult", "key-1", undefined, { usePoints: true, expectedAmountKobo: 475_000 });
    expect(mockInvoke).toHaveBeenCalledWith("order-checkout", { body: { code: "proof_consult", client_key: "key-1", use_points: true, expected_amount_kobo: 475_000 } });
    mockInvoke.mockClear();
    await startCheckout("proof_consult", "key-2");
    expect(mockInvoke).toHaveBeenCalledWith("order-checkout", { body: { code: "proof_consult", client_key: "key-2" } });
  });

  it("asks for a quote with or without points and returns null when it cannot be worked out", async () => {
    mockRpc.mockResolvedValueOnce({ data: { item_code: "c", list_kobo: 500_000, amount_due_kobo: 475_000, points_applied: 500, points_reduction_kobo: 25_000,
      lines: [{ rule: "list", label_key: "quote.line.list", amount_kobo: 500_000, running_kobo: 500_000, applied: true, reason_key: null }, { rule: "points", label_key: "quote.line.points", amount_kobo: -25_000, running_kobo: 475_000, applied: true, reason_key: null }] }, error: null });
    const q = await loadQuote("c", true);
    expect(mockRpc).toHaveBeenCalledWith("price_quote", { p_code: "c", p_use_points: true });
    expect(q?.amountDueKobo).toBe(475_000);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadQuote("c")).toBeNull();
    expect(mockRpc).toHaveBeenLastCalledWith("price_quote", { p_code: "c" });
  });

  it("reads entitlements with their source and days left", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "e1", kind: "consultation_credit", state: "active", name_key: "k", remaining_uses: 3, days_left: null, source: "access_fund", sponsor_name: null, part_covered: false }], error: null });
    const r = await loadEntitlements();
    expect(r.ok && r.data[0]).toMatchObject({ remainingUses: 3, source: "access_fund" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    expect(await loadEntitlements()).toEqual({ ok: false, error: "nope" });
  });

  it("requests a refund through the existing database function and returns its word", async () => {
    mockRpc.mockResolvedValue({ data: { result: "requested", refund_id: "r1" }, error: null });
    expect(await requestRefund("o1", "I changed my mind")).toEqual({ result: "requested" });
    expect(mockRpc).toHaveBeenCalledWith("request_order_refund", { p_order: "o1", p_reason: "I changed my mind" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await requestRefund("o1", "I changed my mind")).toBeNull();
    mockRpc.mockResolvedValue({ data: { result: 5 }, error: null });
    expect(await requestRefund("o1", "I changed my mind")).toBeNull();
  });

  it("creates a payment request and returns the code once; a refusal keeps its stable code", async () => {
    mockRpc.mockResolvedValue({ data: { request_id: "r1", code: "pr_abcdefghijklmnopqrstuvwx", expires_at: "2026-10-08T00:00:00Z" }, error: null });
    const ok = await createPaymentRequest("membership_annual");
    expect(ok).toEqual({ ok: true, request: { requestId: "r1", code: "pr_abcdefghijklmnopqrstuvwx", expiresAt: "2026-10-08T00:00:00Z" } });
    expect(mockRpc).toHaveBeenCalledWith("create_payment_request", { p_item_code: "membership_annual" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "gift_item_not_allowed" } });
    expect(await createPaymentRequest("consultation_single")).toEqual({ ok: false, code: "gift_item_not_allowed" });
    mockRpc.mockResolvedValue({ data: { request_id: "r1", code: "bad", expires_at: "t" }, error: null });
    expect(await createPaymentRequest("membership_annual")).toEqual({ ok: false, code: "unknown" });
  });

  it("lists and cancels requests", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "r1", item_code: "membership_annual", name_key: "k", status: "open", created_at: "a", expires_at: "b", paid_at: null }], error: null });
    const l = await loadPaymentRequests();
    expect(l.ok && l.data).toHaveLength(1);
    mockRpc.mockResolvedValue({ data: { result: "payment_in_progress" }, error: null });
    expect(await cancelPaymentRequest("r1")).toBe("payment_in_progress");
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await cancelPaymentRequest("r1")).toBe("unknown");
  });

  it("parses who the buyer is and the refund state, and maps a request refusal to its words", () => {
    const o = { order_id: "o1", state: "paid", amount_kobo: 500_000, total_kobo: 500_150, name_key: "k", created_at: "2026-10-06T10:00:00Z", paid_at: null };
    expect(parseOrders([{ ...o, is_buyer: false, refund_state: "pending" }])[0]).toMatchObject({ isBuyer: false, refundState: "pending" });
    expect(parseOrders([o])[0]).toMatchObject({ isBuyer: true, refundState: null });
    expect(checkoutErrorKey("request_expired")).toBe("request.error.expired");
    expect(Object.hasOwn(en, checkoutErrorKey("request_in_use"))).toBe(true);
  });

  it("a catalogue row carries both the price split (checkout) and how long it lasts (monthly line)", () => {
    const row = parseCatalogue([{ ...item, duration_days: 365, components: { partner_fee: 3_000_000, tarragon_service_fee: 9_000_000 } }])[0];
    expect(row).toMatchObject({ durationDays: 365, components: { partner_fee: 3_000_000, tarragon_service_fee: 9_000_000 } });
  });

  it("WP1: keeps how long an item lasts so the yearly price can show a monthly equivalent, and nothing for a bad value", () => {
    expect(parseCatalogue([{ ...item, duration_days: 365 }])[0]).toMatchObject({ durationDays: 365 });
    expect(parseCatalogue([{ ...item, duration_days: null }])[0]).toMatchObject({ durationDays: null });
    expect(parseCatalogue([{ ...item, duration_days: "365" }])[0]).toMatchObject({ durationDays: null });
    expect(parseCatalogue([item])[0]).toMatchObject({ durationDays: null });
  });

  it("WP1: loads the not-included list and the price-change notices, and a failed read is an error the screen ignores, not a guess", async () => {
    mockRpc.mockResolvedValue({ data: [{ code: "membership_annual", items: [{ label_key: "catalog.notincl.medicines", extra_code: null, amount_kobo: null }] }], error: null });
    const ni = await loadNotIncluded();
    expect(ni.ok && ni.data["membership_annual"]).toEqual([{ labelKey: "catalog.notincl.medicines", extraCode: null, amountKobo: null }]);
    expect(mockRpc).toHaveBeenLastCalledWith("catalogue_not_included");
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await loadPriceChangeNotices()).toEqual({ ok: true, data: [] });
    expect(mockRpc).toHaveBeenLastCalledWith("my_price_change_notices");
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await loadNotIncluded()).ok).toBe(false);
    expect((await loadPriceChangeNotices()).ok).toBe(false);
  });

  it("a member in the 14 day grace is shown both tier cards on the phone (the screen passes the parsed state to arrangeItems)", () => {
    const grace = parseMembership({ is_member: true, in_grace: true, tier: "plus", ends_at: "2026-10-20T00:00:00Z", grace_ends_at: "2026-11-03T00:00:00Z" });
    const items = [{ code: "membership_annual" }, { code: "membership_annual_no_panel" }, { code: "membership_upgrade_plus" }];
    const arranged = arrangeItems(items, { tier: grace.isMember ? (grace.tier ?? null) : null, isMember: grace.isMember, inGrace: false, forSomeoneElse: false });
    expect(arranged.tierCards.map((i) => i.code)).toEqual(["membership_annual_no_panel", "membership_annual"]);
    expect(arranged.upgrade).toBeNull();
    // a current Plus member sees no card to buy
    const current = parseMembership({ is_member: true, tier: "plus", ends_at: "2027-08-01T00:00:00Z" });
    expect(arrangeItems(items, { tier: current.tier ?? null, isMember: current.isMember, inGrace: false, forSomeoneElse: false }).tierCards).toEqual([]);
  });

  it("Plus: parses the approved states, drops rows that are not states, and keeps the member's fixed state", () => {
    expect(parsePlusStates([{ state: "Lagos", display_name: "Lagos" }, { state: 5 }, null, { state: "Oyo", display_name: "Oyo" }])).toEqual([{ state: "Lagos", displayName: "Lagos" }, { state: "Oyo", displayName: "Oyo" }]);
    expect(parsePlusStates("nope")).toEqual([]);
    expect(parseMembership({ is_member: true, tier: "plus", ends_at: "2027-08-01T00:00:00Z", collection_state: "Ogun" })).toEqual({ isMember: true, endsAt: "2027-08-01T00:00:00Z", tier: "plus", collectionState: "Ogun" });
  });

  it("Plus: the new refusals have copy, never a raw code", () => {
    for (const code of ["plus_state_required", "plus_state_not_available", "upgrade_already_open", "upgrade_not_available"]) {
      const key = checkoutErrorKey(code);
      expect(Object.hasOwn(en, key)).toBe(true);
      expect(key).not.toBe("shop.error.unknown");
    }
  });

  it("Plus: the chosen state is sent with the order only when there is one, and a failed read of the states is an empty list", async () => {
    mockInvoke.mockResolvedValue({ data: { order_id: "o", reference: "r", amount_kobo: 12900000, checkout_url: "https://checkout.paystack.com/x" }, error: null });
    await startCheckout("membership_annual", "k1", undefined, { collectionState: "Lagos" });
    expect((mockInvoke.mock.calls.at(-1)![1] as { body: Record<string, unknown> }).body).toMatchObject({ code: "membership_annual", collection_state: "Lagos" });
    await startCheckout("membership_annual_no_panel", "k2");
    expect((mockInvoke.mock.calls.at(-1)![1] as { body: Record<string, unknown> }).body).not.toHaveProperty("collection_state");
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await loadPlusStates()).toEqual([]);
    mockRpc.mockResolvedValue({ data: [{ state: "Osun", display_name: "Osun" }], error: null });
    expect(await loadPlusStates()).toEqual([{ state: "Osun", displayName: "Osun" }]);
  });
});
