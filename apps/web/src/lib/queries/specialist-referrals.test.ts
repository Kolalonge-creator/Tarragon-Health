import { describe, expect, it } from "@jest/globals";
import { parseReferral, parseReferralList } from "./specialist-referrals";

describe("referral audited-read parsers (INV-10)", () => {
  it("the queue list is the array the function returned", () => {
    expect(parseReferralList([{ id: "r1" }])).toEqual([{ id: "r1" }]);
    expect(parseReferralList([])).toEqual([]);
  });

  it("a non-array queue response is an error, not an empty queue", () => {
    expect(() => parseReferralList(null)).toThrow();
    expect(() => parseReferralList({ status: "denied" })).toThrow();
  });

  it("the per-patient list needs status ok; a refusal throws and never reads as no referrals", () => {
    expect(parseReferralList({ status: "ok", referrals: [{ id: "r1" }] }, "referrals")).toEqual([{ id: "r1" }]);
    expect(parseReferralList({ status: "ok", referrals: [] }, "referrals")).toEqual([]);
    expect(() => parseReferralList({ status: "denied", referrals: [] }, "referrals")).toThrow();
    expect(() => parseReferralList(null, "referrals")).toThrow();
  });

  it("one referral needs status ok and a body", () => {
    expect(parseReferral({ status: "ok", referral: { id: "r1" } })).toEqual({ id: "r1" });
    expect(() => parseReferral({ status: "denied" })).toThrow();
    expect(() => parseReferral({ status: "ok" })).toThrow();
    expect(() => parseReferral(null)).toThrow();
  });
});
