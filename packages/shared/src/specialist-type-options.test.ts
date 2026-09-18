import { Constants } from "./database.types";
import {
  SPECIALIST_TYPE_LABEL,
  SPECIALIST_TYPE_NOUN,
  SPECIALIST_TYPE_OPTIONS,
  SPECIALIST_TYPE_VALUES,
  SPECIALIST_TYPES,
  specialistTypeNoun,
} from "./specialist-type-options";

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
    expect([...SPECIALIST_TYPE_VALUES].sort()).toEqual(liveValues);
  });

  it("has no duplicate values", () => {
    expect(new Set(SPECIALIST_TYPES).size).toBe(SPECIALIST_TYPES.length);
  });

  it("labels every option, and only options that exist", () => {
    for (const { value, label } of SPECIALIST_TYPE_OPTIONS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(SPECIALIST_TYPE_LABEL[value]).toBe(label);
    }
    expect(Object.keys(SPECIALIST_TYPE_LABEL).sort()).toEqual([...SPECIALIST_TYPES].sort());
  });

  it("SPECIALIST_TYPE_NOUN has a real, non-empty entry for every live value -- the drift class that let genitourinary_medicine fall through to a raw label in a referral letter", () => {
    for (const value of SPECIALIST_TYPES) {
      const noun = SPECIALIST_TYPE_NOUN[value];
      expect(typeof noun).toBe("string");
      expect(noun.length).toBeGreaterThan(0);
      expect(specialistTypeNoun(value)).toBe(noun);
    }
    expect(Object.keys(SPECIALIST_TYPE_NOUN).sort()).toEqual([...SPECIALIST_TYPES].sort());
  });

  it("specialistTypeNoun falls back to a humanised string for a value outside the known enum", () => {
    expect(specialistTypeNoun("not_a_real_type")).toBe("not a real type");
  });
});
