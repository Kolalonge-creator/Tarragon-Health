import { describe, expect, it } from "@jest/globals";
import { referralDestination } from "./referral-destination";

describe("referralDestination (S64, 15.6)", () => {
  it("names the facility when one is set", () => {
    const d = referralDestination("cardiologist", "Lagos Heart Centre");
    expect(d.title).toContain("at Lagos Heart Centre");
    expect(d.note).toContain("facility named above");
  });
  it("keeps the original wording when none is named (existing referrals print as before)", () => {
    expect(referralDestination("cardiologist", null).title).toMatch(/^To: any .* the patient chooses$/);
    expect(referralDestination("cardiologist", "   ").title).toMatch(/the patient chooses$/);
  });
});
