import { referralConsentTimestamp, submitConsentTimestamp } from "./create-referral";

const NOW = new Date("2026-10-06T09:00:00Z");

describe("referralConsentTimestamp", () => {
  it("a draft is sent without a consent time, ticked or not", () => {
    expect(referralConsentTimestamp({ asDraft: true, consentConfirmed: false }, NOW)).toBeNull();
    expect(referralConsentTimestamp({ asDraft: true, consentConfirmed: true }, NOW)).toBeNull();
  });

  it("a submitted referral with the confirmation sends now", () => {
    expect(referralConsentTimestamp({ asDraft: false, consentConfirmed: true }, NOW)).toBe("2026-10-06T09:00:00.000Z");
  });

  it("a submitted referral without the confirmation is refused with a readable message", () => {
    expect(() => referralConsentTimestamp({ asDraft: false, consentConfirmed: false }, NOW)).toThrow(/patient agreed to share their record/);
  });

  it("submitting a saved draft needs the same confirmation", () => {
    expect(submitConsentTimestamp(true, NOW)).toBe("2026-10-06T09:00:00.000Z");
    expect(() => submitConsentTimestamp(false, NOW)).toThrow(/patient agreed/);
  });
});
