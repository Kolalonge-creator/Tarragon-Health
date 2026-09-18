import { describe, expect, it } from "@jest/globals";
import { SPECIALIST_TYPE_LABEL, SPECIALIST_TYPE_OPTIONS } from "./specialist-type-options";

/**
 * Regression test for the bug this file's own header comment documents:
 * create-referral-form.tsx used to carry its own, separate specialist-type
 * option list that was missing `genitourinary_medicine` — a real,
 * selectable specialist_type value — so a clinician could not actually
 * create a referral to that specialty even though the column supported it.
 *
 * `SPECIALIST_TYPE_LABEL satisfies Record<SpecialistType, string>` already
 * makes a missing enum member a compile-time error, but this test locks in
 * the specific fixed bug (per CLAUDE.md's "every confirmed bug fix gets a
 * standing regression test") in case a future refactor drops that
 * `satisfies` clause — the test would still catch a regression the type
 * system no longer would.
 */
describe("SPECIALIST_TYPE_LABEL / SPECIALIST_TYPE_OPTIONS", () => {
  it("includes genitourinary_medicine (the value the bug dropped)", () => {
    expect(SPECIALIST_TYPE_LABEL.genitourinary_medicine).toBe("Genitourinary medicine");
    expect(SPECIALIST_TYPE_OPTIONS.map((o) => o.value)).toContain("genitourinary_medicine");
  });

  it("has no duplicate values", () => {
    const values = SPECIALIST_TYPE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every option a non-empty label", () => {
    for (const option of SPECIALIST_TYPE_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("derives SPECIALIST_TYPE_OPTIONS from SPECIALIST_TYPE_LABEL with nothing dropped or added", () => {
    expect(SPECIALIST_TYPE_OPTIONS.length).toBe(Object.keys(SPECIALIST_TYPE_LABEL).length);
  });
});
