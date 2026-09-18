import { Constants } from "./database.types";
import { SPECIALIST_TYPE_LABEL, SPECIALIST_TYPE_OPTIONS, SPECIALIST_TYPE_VALUES, SPECIALIST_TYPES } from "./specialist-type-options";

describe("specialist type options", () => {
  it("covers every live specialist_type enum value -- the drift this file exists to stop", () => {
    // Before this file existed, at least six call sites each hand-copied
    // their own subset of the enum and drifted out of sync with it in a
    // different way (missing psychiatry, psychology, and/or
    // genitourinary_medicine) as the enum grew. This asserts against the
    // generated Constants array (packages/shared/src/database.types.ts),
    // the same source of truth the DB itself was built from, so adding a
    // new specialist_type value without also adding it here fails the
    // build instead of silently shipping an incomplete picker.
    const liveValues = [...Constants.public.Enums.specialist_type].sort();
    expect([...SPECIALIST_TYPES].sort()).toEqual(liveValues);
  });

  it("has no duplicate values", () => {
    expect(new Set(SPECIALIST_TYPES).size).toBe(SPECIALIST_TYPES.length);
  });

  it("SPECIALIST_TYPE_VALUES (the literal tuple zod consumers derive their enum from) matches SPECIALIST_TYPES exactly", () => {
    expect([...SPECIALIST_TYPE_VALUES].sort()).toEqual([...SPECIALIST_TYPES].sort());
  });

  it("labels every option, and only options that exist", () => {
    for (const { value, label } of SPECIALIST_TYPE_OPTIONS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(SPECIALIST_TYPE_LABEL[value]).toBe(label);
    }
    expect(Object.keys(SPECIALIST_TYPE_LABEL).sort()).toEqual([...SPECIALIST_TYPES].sort());
  });
});
