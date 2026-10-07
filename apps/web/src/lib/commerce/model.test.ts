import { en } from "@tarragon/i18n";
import { estimatedBreakdown, formatNaira } from "@tarragon/commerce";
import { checkoutErrorKey, isMessageKey, orderStateKey, parseCatalogue, parseMembership, parseOrders, ORDER_STATES } from "./model";

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
