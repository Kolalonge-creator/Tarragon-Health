import { describe, expect, it } from "@jest/globals";
import { parseEntitlements, entitlementLines } from "../../../supabase/functions/_shared/commerce/entitlements.ts";
import { parseDonations, parseFundReport, parseFundSupport, fundErrorKey } from "../../../supabase/functions/_shared/commerce/fund.ts";
import { parseCreatedPaymentRequest, parsePaymentRequests, parsePreview, previewMessageKey, requestErrorKey } from "../../../supabase/functions/_shared/commerce/payment-request.ts";

describe("malformed input never becomes a figure or a claim", () => {
  it("entitlements: rows with missing parts are dropped; a care pack and a lab panel use their own nouns", () => {
    expect(parseEntitlements([{ id: "a", kind: "x", state: "active" }, [], "s"])).toEqual([]);
    const e = parseEntitlements([{ id: "a", kind: "care_pack", state: "active", name_key: "k", remaining_uses: 1 }, { id: "b", kind: "lab_panel", state: "active", name_key: "k", remaining_uses: 2 }]);
    expect(entitlementLines(e[0]!)[0]!.key).toBe("entitlement.remaining.care_pack_one");
    expect(entitlementLines(e[1]!)[0]!.key).toBe("entitlement.remaining.lab_panel_other");
  });
  it("fund report: every unusable shape is closed or withheld", () => {
    expect(parseFundReport("x")).toEqual({ open: false, criteria: [] });
    expect(parseFundReport({ open: true, min_cell: 20 })).toMatchObject({ open: true, donations: { withheld: true }, grants: { withheld: true } });
    const r = parseFundReport({ open: true, min_cell: 20, criteria: ["a", 3], donations: { count: "x" }, grants: { count: 30, total_kobo: 1, by_kind: [null, { kind: 1 }, { kind: "k", count: 25, total_kobo: -1 }, "s"] } });
    expect(r.open && r.criteria).toEqual(["a"]);
    expect(r.open && r.grants).toMatchObject({ withheld: false, cells: [] });
    const t = parseFundReport({ open: true, min_cell: 20, grants: { count: 30 } });
    expect(t.open && t.grants).toMatchObject({ totalsWithheld: true, count: null });
  });
  it("donations and support: bad rows dropped, non-lists empty", () => {
    expect(parseDonations(null)).toEqual([]);
    expect(parseDonations([null, { id: "d", reference: "r", amount_kobo: 1, state: "pledged" }, { id: "d", reference: "r", amount_kobo: 1, state: "pledged", created_at: "a", pledge_expires_at: "b", item_name_key: "k" }]).map((d) => d.itemNameKey)).toEqual(["k"]);
    expect(parseFundSupport(undefined)).toEqual([]);
    expect(parseFundSupport([null, { item_code: "x" }, { item_code: "x", expires_at: "t", status: "approved" }])).toHaveLength(1);
    for (const m of ["donation_amount_invalid", "too_many_open_pledges", "item_not_available"]) expect(fundErrorKey(m)).toMatch(/^fund\.error\./);
  });
  it("payment requests: junk is unknown, every state has a key", () => {
    expect(parsePaymentRequests("x")).toEqual([]);
    expect(parsePaymentRequests([null, { id: "r", item_code: "c", name_key: "k", status: "open", created_at: "a", expires_at: "b", paid_at: "p" }])[0]!.paidAt).toBe("p");
    expect(parseCreatedPaymentRequest(null)).toBeNull();
    expect(parseCreatedPaymentRequest({ request_id: 1 })).toBeNull();
    expect(parsePreview("x")).toEqual({ status: "unknown" });
    expect(parsePreview({ status: "open", name_key: "k", amount_kobo: 5, expires_at: "t", components: "bad" })).toMatchObject({ status: "open", components: {} });
    for (const c of ["request_cancelled", "request_used", "request_in_use", "request_own", "request_not_payable", "already_member", "too_many_requests", "checkout_not_open"]) expect(requestErrorKey(c)).toBeTruthy();
    for (const s of ["expired", "cancelled", "paid", "pending_payment", "rate_limited", "unavailable", "unknown"] as const) expect(previewMessageKey(s)).toBeTruthy();
  });
});
