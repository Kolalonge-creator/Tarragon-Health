import type { PatientReceiptServiceType } from "./receipts";

/**
 * Platform Credit was removed, so a patient receipt can no longer have the
 * 'platform_credit_topup' service type. The @ts-expect-error below fails the
 * type-check (and so this suite under ts-jest) if the value ever returns to
 * the union.
 */
describe("PatientReceiptServiceType", () => {
  it("does not include the retired platform_credit_topup type", () => {
    // @ts-expect-error platform_credit_topup is no longer a receipt service type
    const retired: PatientReceiptServiceType = "platform_credit_topup";
    const current: PatientReceiptServiceType[] = [
      "membership",
      "laboratory",
      "pharmacy",
      "referral",
      "consultation",
      "care_voucher",
    ];
    expect(current).not.toContain(retired);
  });
});
