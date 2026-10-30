import { fallbackRefundPolicy, type RefundPolicy } from "@/lib/commerce/refund-rule";
import { refundWindowDaysFor, refundWindowOpen } from "./refund-window";

const HOUR_MS = 60 * 60 * 1000;
const PAID = "2026-10-01T10:00:00.000Z";
const paidMs = Date.parse(PAID);

describe("refundWindowOpen: the database's own boundary (refused when now() > paid_at + window days)", () => {
  it("accepts the very last moment, exactly 504 hours after payment for the 21-day window", () => {
    expect(refundWindowOpen(PAID, 21, new Date(paidMs + 504 * HOUR_MS))).toBe(true);
  });

  it("refuses one millisecond later", () => {
    expect(refundWindowOpen(PAID, 21, new Date(paidMs + 504 * HOUR_MS + 1))).toBe(false);
  });

  it("is open on the day of payment and well inside the window", () => {
    expect(refundWindowOpen(PAID, 21, new Date(paidMs))).toBe(true);
    expect(refundWindowOpen(PAID, 21, new Date(paidMs + 20 * 24 * HOUR_MS))).toBe(true);
  });

  it("uses the days it is given, never a fixed 21", () => {
    expect(refundWindowOpen(PAID, 30, new Date(paidMs + 25 * 24 * HOUR_MS))).toBe(true);
    expect(refundWindowOpen(PAID, 14, new Date(paidMs + 15 * 24 * HOUR_MS))).toBe(false);
  });

  it("is closed when the order has no payment time, as the database refuses it", () => {
    expect(refundWindowOpen(null, 21, new Date(paidMs))).toBe(false);
  });

  it("leaves the button on when the payment time cannot be read, so the database gives the real answer", () => {
    expect(refundWindowOpen("not a date", 21, new Date(paidMs + 400 * 24 * HOUR_MS))).toBe(true);
  });
});

describe("refundWindowDaysFor: which window applies to which order", () => {
  const policy: RefundPolicy = { ...fallbackRefundPolicy(), membershipWindowDays: 21, coolingOffDays: 14 };

  it("a Membership has its own window and every other order has the cooling-off one", () => {
    expect(refundWindowDaysFor(policy, "membership")).toBe(21);
    expect(refundWindowDaysFor(policy, "consultation")).toBe(14);
    expect(refundWindowDaysFor(policy, "care_pack")).toBe(14);
  });

  it("an item the screen does not know takes the longer window, so a right the database would honour is not hidden", () => {
    expect(refundWindowDaysFor(policy, undefined)).toBe(21);
    expect(refundWindowDaysFor({ ...policy, membershipWindowDays: 7 }, undefined)).toBe(14);
  });

  it("the Membership window in the shared config is 21 days", () => {
    expect(fallbackRefundPolicy().membershipWindowDays).toBe(21);
  });
});
