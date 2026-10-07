import { describe, expect, it } from "@jest/globals";
import {
  isPaymentRequestCode, parseCreatedPaymentRequest, parsePaymentRequests, parsePreview, paymentRequestLink, previewMessageKey, requestErrorKey,
} from "../../../supabase/functions/_shared/commerce/payment-request.ts";

const CODE = "pr_abcdefghijklmnopqrstuvwx";

describe("payment request codes and links", () => {
  it("accepts only the exact shape", () => {
    expect(isPaymentRequestCode(CODE)).toBe(true);
    for (const bad of ["pr_short", "xx_abcdefghijklmnopqrstuvwx", `${CODE}x`, "pr_abcdefghijklmnopqrstuvw!", "", null, 5, "../etc/passwd"]) expect(isPaymentRequestCode(bad)).toBe(false);
  });
  it("builds the link on the platform base and refuses a bad code", () => {
    expect(paymentRequestLink("https://app.tarragonhealth.ng/", CODE)).toBe(`https://app.tarragonhealth.ng/checkout/${CODE}`);
    expect(() => paymentRequestLink("https://x.test", "nope")).toThrow();
  });
  it("the link carries the code and nothing about the person or the item (INV-07)", () => {
    const link = paymentRequestLink("https://app.example", CODE);
    expect(link).toBe(`https://app.example/checkout/${CODE}`);
    expect(link).not.toMatch(/[?&=]/);
  });
});

describe("parsePreview", () => {
  it("reads an open request with its generic item key and the amount", () => {
    const p = parsePreview({ status: "open", name_key: "catalog.membership.name", amount_kobo: 10_000_000, components: { tarragon_service_fee: 2_000_000, partner_fee: "x" }, expires_at: "2026-10-14T00:00:00Z" });
    expect(p).toEqual({ status: "open", nameKey: "catalog.membership.name", amountKobo: 10_000_000, components: { tarragon_service_fee: 2_000_000 }, expiresAt: "2026-10-14T00:00:00Z" });
  });
  it("an open reply with no usable amount is unknown, not a free item", () => {
    expect(parsePreview({ status: "open", name_key: "k", amount_kobo: 0, expires_at: "x" })).toEqual({ status: "unknown" });
    expect(parsePreview({ status: "open", name_key: "k", amount_kobo: 1.5, expires_at: "x" })).toEqual({ status: "unknown" });
  });
  it("non-open states and nonsense", () => {
    expect(parsePreview({ status: "expired" })).toEqual({ status: "expired" });
    expect(parsePreview({ status: "pending_payment" })).toEqual({ status: "pending_payment" });
    expect(parsePreview({ status: "hacked" })).toEqual({ status: "unknown" });
    expect(parsePreview(null)).toEqual({ status: "unknown" });
  });
  it("every non-open state has its own plain message and none names the item or the person", () => {
    for (const s of ["expired", "cancelled", "paid", "pending_payment", "unknown", "unavailable", "rate_limited"] as const) expect(previewMessageKey(s)).toMatch(/^request\.page\./);
  });
});

describe("the rest", () => {
  it("parses the requester's list and drops broken rows", () => {
    const rows = parsePaymentRequests([{ id: "r1", item_code: "membership_annual", name_key: "k", status: "open", created_at: "a", expires_at: "b", paid_at: null }, { id: 2 }, { id: "r3", item_code: "x", name_key: "k", status: "nope", created_at: "a", expires_at: "b" }]);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
  });
  it("a created request must carry a well-formed code", () => {
    expect(parseCreatedPaymentRequest({ request_id: "r1", code: CODE, expires_at: "t" })).toEqual({ requestId: "r1", code: CODE, expiresAt: "t" });
    expect(parseCreatedPaymentRequest({ request_id: "r1", code: "bad", expires_at: "t" })).toBeNull();
  });
  it("error codes map to keys and unknown ones to the general key", () => {
    expect(requestErrorKey("request_expired")).toBe("request.error.expired");
    expect(requestErrorKey("gift_item_not_allowed")).toBe("request.error.item_not_allowed");
    expect(requestErrorKey("whatever")).toBe("request.error.unknown");
  });
});
