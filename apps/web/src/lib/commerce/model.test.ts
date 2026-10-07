import { en } from "@tarragon/i18n";
import { estimatedBreakdown, formatNaira } from "@tarragon/commerce";
import { checkoutErrorKey, checkoutReplySchema, hmoErrorKey, isCoveredReply, isMessageKey, orderStateKey, parseCatalogue, parseHmoChecks, parseHmoPlans, parseMembership, parseOrders, ORDER_STATES } from "./model";

const item = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 10_000_000, components: {},
};

describe("parseCatalogue", () => {
  it("keeps good rows and drops bad ones one by one", () => {
    const rows = parseCatalogue([item, { ...item, code: "BAD CODE" }, { ...item, amount_kobo: 0 }, { ...item, amount_kobo: 12.5 }, { ...item, kind: "wallet" }, null, "x"]);
    expect(rows.map((r) => r.code)).toEqual(["membership_annual"]);
  });
  it("treats anything that is not a list as empty", () => {
    for (const v of [null, undefined, {}, "x", 3]) expect(parseCatalogue(v)).toEqual([]);
  });
});

describe("parseOrders and parseMembership", () => {
  const order = { order_id: "o1", state: "paid", amount_kobo: 500_000, fee_kobo: 150, total_kobo: 500_150, code: "x_item", name_key: "k", created_at: "2026-10-06T10:00:00Z", paid_at: "2026-10-06T10:01:00Z" };
  it("parses orders and drops malformed ones", () => {
    expect(parseOrders([order, { ...order, state: "teleported" }, { ...order, amount_kobo: -1 }])).toHaveLength(1);
    expect(parseOrders("nope")).toEqual([]);
  });
  it("falls back to not a member on a strange reply", () => {
    expect(parseMembership({ is_member: true, ends_at: "2027-10-06T00:00:00Z", source: "purchase" }).is_member).toBe(true);
    expect(parseMembership(null)).toEqual({ is_member: false, ends_at: null, source: null });
    expect(parseMembership({ is_member: "yes" }).is_member).toBe(false);
  });
});

describe("copy keys", () => {
  it("every checkout error code maps to a real key in both languages, and unknown codes get the generic one", () => {
    for (const code of ["checkout_not_open", "item_not_available", "already_member", "no_capacity", "too_many_open_orders", "email_needed", "payment_unavailable", "checkout_link_lost", "already_paid", "order_closed", "unknown"]) {
      const key = checkoutErrorKey(code);
      expect(en[key].length).toBeGreaterThan(0);
    }
    expect(checkoutErrorKey("surprise")).toBe("shop.error.unknown");
    expect(checkoutErrorKey(undefined)).toBe("shop.error.unknown");
    expect(checkoutErrorKey("no_capacity")).toBe("shop.error.no_capacity");
  });
  it("S73: every pricing refusal has its own message, never the generic one", () => {
    for (const code of ["membership_not_open", "quote_changed", "sponsor_billing_not_open", "order_fully_covered", "discount_code_invalid", "discount_code_rate_limited"]) {
      const key = checkoutErrorKey(code);
      expect(key).not.toBe("shop.error.unknown");
      expect(en[key].length).toBeGreaterThan(0);
    }
  });
  it("every order state has a label", () => {
    for (const s of ORDER_STATES) expect(en[orderStateKey(s)].length).toBeGreaterThan(0);
  });
  it("the seeded catalogue copy keys all exist; an unknown key is not a message key", () => {
    for (const k of ["catalog.membership_annual.name", "catalog.membership_annual.description", "catalog.membership_annual.incl.1", "catalog.membership_annual.incl.4", "catalog.bp_care_pack_3m.name", "catalog.bp_care_pack_3m.incl.4"]) {
      expect(isMessageKey(k, en)).toBe(true);
    }
    expect(isMessageKey("catalog.nothing.here", en)).toBe(false);
    expect(isMessageKey("constructor", en)).toBe(false);
  });
  it("catalogue copy never claims what the platform must not (no cure, free healthcare or your doctor)", () => {
    const all = Object.entries(en).filter(([k]) => k.startsWith("catalog.") || k.startsWith("shop.")).map(([, v]) => v).join(" ");
    expect(all).not.toMatch(/\bcure|free healthcare|your doctor|instant doctor|—/i);
  });
});

describe("the web imports the shared commerce core", () => {
  it("formats the membership price and adds up an estimate that is labelled as one", () => {
    expect(formatNaira(10_000_000)).toBe("100,000");
    const b = estimatedBreakdown(10_000_000, { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 });
    expect(b.estimated).toBe(true);
    expect(b.totalKobo).toBe(b.priceKobo + b.feeKobo);
  });
});

describe("S71 additions", () => {
  it("accepts a covered checkout reply (no checkout link) and an ordinary one, and tells them apart", () => {
    const covered = checkoutReplySchema.parse({ covered: true, order_id: "o", reference: "spo_x", sponsor_name: "Acme Ltd" });
    expect(isCoveredReply(covered)).toBe(true);
    const pay = checkoutReplySchema.parse({ order_id: "o", reference: "tho_x", amount_kobo: 100, checkout_url: "https://checkout.paystack.com/x" });
    expect(isCoveredReply(pay)).toBe(false);
    expect(checkoutReplySchema.safeParse({ order_id: "o", reference: "tho_x", amount_kobo: 100 }).success).toBe(false);
  });
  it("maps the sponsor and health plan refusals to messages", () => {
    expect(checkoutErrorKey("sponsor_budget_exhausted")).toBe("shop.error.sponsor_budget_exhausted");
    expect(hmoErrorKey("member_number_invalid")).toBe("hmo.error.member_number_invalid");
    expect(hmoErrorKey("anything else")).toBe("hmo.error.unknown");
  });
  it("reads orders with and without sponsor fields", () => {
    const base = { order_id: "o", state: "paid", amount_kobo: 0, fee_kobo: 0, total_kobo: 0, code: "c", name_key: "k", created_at: "2026-10-01", paid_at: "2026-10-01" };
    expect(parseOrders([base])[0]).toMatchObject({ sponsor_share_kobo: 0, sponsor_name: null });
    expect(parseOrders([{ ...base, sponsor_share_kobo: 500, sponsor_name: "Acme Ltd" }])[0]).toMatchObject({ sponsor_share_kobo: 500, sponsor_name: "Acme Ltd" });
  });
  it("keeps good health plan rows and drops bad ones", () => {
    expect(parseHmoPlans([{ hmo_id: "h", name: "A" }, { nope: 1 }])).toHaveLength(1);
    expect(parseHmoChecks([{ check_id: "c", hmo_name: "A", result: "eligible", checked_at: "x", decided_at: null }, { check_id: "d", hmo_name: "A", result: "weird", checked_at: "x", decided_at: null }])).toHaveLength(1);
  });
});
