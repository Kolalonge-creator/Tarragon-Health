/**
 * GUEST_CHECKOUT_PRODUCT_CODES / guestCheckoutProductCopy used to carry
 * continuous_monitoring_3m/6m/12m and a hardcoded "continuous_monitoring_3m"
 * parentCode fallback — retired 2026-09-22 when Continuous Monitoring
 * collapsed to a single continuous_monitoring_90d tier
 * (20260922185200_continuous_monitoring_90d_single_tier.sql). Left unfixed:
 * (a) the guest-checkout buy page would still advertise three retired,
 * is_active=false codes nobody could actually complete a purchase for
 * (isGuestCheckoutProductCode/guest-checkout.ts's server-side re-validation
 * would refuse them), and (b) guestCheckoutProductCopy's parentCode lookup
 * hardcoded "continuous_monitoring_3m", which no longer exists in
 * PAID_SERVICES at all once pricing.ts's entry was repriced to the 90-day
 * code — every continuous-monitoring guest-checkout code would have resolved
 * to `null` copy (a blank card), not stale copy.
 */

import { GUEST_CHECKOUT_PRODUCT_CODES, guestCheckoutProductCopy, isGuestCheckoutProductCode } from "./guest-checkout-products";

describe("GUEST_CHECKOUT_PRODUCT_CODES", () => {
  it("lists only the live 90-day Continuous Monitoring code", () => {
    expect(GUEST_CHECKOUT_PRODUCT_CODES).toContain("continuous_monitoring_90d");
    expect(GUEST_CHECKOUT_PRODUCT_CODES).not.toContain("continuous_monitoring_3m");
    expect(GUEST_CHECKOUT_PRODUCT_CODES).not.toContain("continuous_monitoring_6m");
    expect(GUEST_CHECKOUT_PRODUCT_CODES).not.toContain("continuous_monitoring_12m");
  });

  it("no longer recognises a retired 3/6/12-month code as guest-buyable", () => {
    expect(isGuestCheckoutProductCode("continuous_monitoring_3m")).toBe(false);
    expect(isGuestCheckoutProductCode("continuous_monitoring_90d")).toBe(true);
  });
});

describe("guestCheckoutProductCopy", () => {
  it("resolves real copy for the live 90-day code, not null", () => {
    const copy = guestCheckoutProductCopy("continuous_monitoring_90d");
    expect(copy).not.toBeNull();
    expect(copy?.name).toBe("Continuous Monitoring");
    expect(copy?.staticPrice).toBe("₦30,000");
  });
});
