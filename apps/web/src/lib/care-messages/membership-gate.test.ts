import { isMemberOnlyCategory, isMembershipRequiredError, MEMBER_ONLY_CATEGORIES } from "./membership-gate";
import { careMessageCategories } from "@/lib/validation/care-messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("MSG-1 membership gate", () => {
  it("gates only clinical and medication, and leaves support categories open", () => {
    expect([...MEMBER_ONLY_CATEGORIES].sort()).toEqual(["clinical", "medication"]);
    for (const c of careMessageCategories) {
      expect(isMemberOnlyCategory(c)).toBe(c === "clinical" || c === "medication");
    }
  });

  it("matches the category list in the database rule", () => {
    const sql = readFileSync(
      join(__dirname, "../../../../../supabase/migrations/20261104225703_msg1_free_members_no_clinical_threads.sql"),
      "utf8",
    );
    const match = sql.match(/select p_category in \(([^)]*)\)/);
    expect(match).not.toBeNull();
    const dbCategories = (match?.[1] ?? "").split(",").map((c) => c.trim().replace(/'/g, "")).sort();
    expect(dbCategories).toEqual([...MEMBER_ONLY_CATEGORIES].sort());
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
