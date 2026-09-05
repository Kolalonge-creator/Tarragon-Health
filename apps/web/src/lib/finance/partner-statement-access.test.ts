import {
  canReadPartnerStatements,
  partnerStatementAccessNotice,
} from "./partner-statement-access";

/**
 * The whole reason this module exists is that RLS filters instead of erroring,
 * so the finance role's empty list is indistinguishable from a genuinely empty
 * ledger unless the page knows the difference up front.
 */

describe("canReadPartnerStatements", () => {
  it("excludes the finance role, which is the one that reaches this page", () => {
    expect(canReadPartnerStatements("finance")).toBe(false);
  });

  it("excludes every other role private.is_org_staff excludes", () => {
    for (const role of [
      "patient",
      "corporate_admin",
      "hmo_admin",
      "pharmacist",
      "lab_partner",
      "lab_liaison",
      "analyst",
      "payer_admin",
      "provider_org_staff",
    ] as const) {
      expect(canReadPartnerStatements(role)).toBe(false);
    }
  });

  it("admits admin and care-team staff", () => {
    expect(canReadPartnerStatements("admin")).toBe(true);
    expect(canReadPartnerStatements("clinician")).toBe(true);
    expect(canReadPartnerStatements("care_coordinator")).toBe(true);
  });

  it("treats a missing role as unable to read, not as able", () => {
    expect(canReadPartnerStatements(null)).toBe(false);
    expect(canReadPartnerStatements(undefined)).toBe(false);
  });
});

describe("partnerStatementAccessNotice", () => {
  it("gives the finance role a reason instead of a false empty state", () => {
    const notice = partnerStatementAccessNotice("finance");
    expect(notice).not.toBeNull();
    // The point of the sentence is that empty here does not mean none exist.
    expect(notice).toContain("whether or not any exist");
  });

  it("stays out of the way for a reader who can actually see the table", () => {
    expect(partnerStatementAccessNotice("admin")).toBeNull();
    expect(partnerStatementAccessNotice("clinician")).toBeNull();
  });
});
