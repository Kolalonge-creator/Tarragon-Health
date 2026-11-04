import { isMemberOnlyCategory, isMembershipRequiredError, MEMBER_ONLY_CATEGORIES } from "./membership-gate";
import { careMessageCategories } from "@/lib/validation/care-messages";

describe("MSG-1 membership gate", () => {
  it("gates only clinical and medication, and leaves support categories open", () => {
    expect([...MEMBER_ONLY_CATEGORIES].sort()).toEqual(["clinical", "medication"]);
    for (const c of careMessageCategories) {
      expect(isMemberOnlyCategory(c)).toBe(c === "clinical" || c === "medication");
    }
  });

  it("recognises the database refusal by its hint", () => {
    expect(isMembershipRequiredError({ code: "42501", message: "Clinical messages...", hint: "membership_required" })).toBe(true);
  });

  it("does not mistake any other failure for the Membership refusal", () => {
    expect(isMembershipRequiredError({ code: "42501", message: "not authorised", hint: null })).toBe(false);
    expect(isMembershipRequiredError(new Error("network"))).toBe(false);
    expect(isMembershipRequiredError(null)).toBe(false);
    expect(isMembershipRequiredError("membership_required")).toBe(false);
  });
});
