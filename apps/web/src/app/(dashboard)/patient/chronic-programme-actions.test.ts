/**
 * buyProgrammeDoctorSupportedAddon used to hardcode
 * serviceProductCode: "continuous_monitoring_3m" — retired 2026-09-22 when
 * the 3/6/12-month Continuous Monitoring ladder collapsed into a single
 * continuous_monitoring_90d tier (20260922185200_continuous_monitoring_90d_
 * single_tier.sql, is_active = false on the old codes). Left unfixed, this
 * call site would have kept selling a product `record_service_purchase_intent`
 * refuses outright once it's inactive — "Could not start checkout" for every
 * patient adding doctor support to their chronic programme. This proves the
 * fix: the addon purchase now asks for the live code.
 */

const purchaseServiceProduct = jest.fn();

jest.mock("@/lib/billing/purchase-service-product", () => ({
  purchaseServiceProduct: (...args: unknown[]) => purchaseServiceProduct(...args),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

import { buyProgrammeDoctorSupportedAddon } from "./chronic-programme-actions";

describe("buyProgrammeDoctorSupportedAddon", () => {
  beforeEach(() => {
    purchaseServiceProduct.mockReset();
  });

  it("buys the live continuous_monitoring_90d product, not a retired 3/6/12-month code", async () => {
    purchaseServiceProduct.mockResolvedValue({ activated: true });

    await buyProgrammeDoctorSupportedAddon("enrolment-1", undefined, new FormData());

    expect(purchaseServiceProduct).toHaveBeenCalledWith(
      expect.objectContaining({ serviceProductCode: "continuous_monitoring_90d" })
    );
    expect(purchaseServiceProduct).not.toHaveBeenCalledWith(
      expect.objectContaining({
        serviceProductCode: expect.stringMatching(/^continuous_monitoring_(3m|6m|12m)$/),
      })
    );
  });

  it("still scopes the purchase to the given enrolment", async () => {
    purchaseServiceProduct.mockResolvedValue({ activated: true });

    await buyProgrammeDoctorSupportedAddon("enrolment-42", undefined, new FormData());

    expect(purchaseServiceProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        scopedEntityType: "chronic_programme_enrolments",
        scopedEntityId: "enrolment-42",
      })
    );
  });
});
