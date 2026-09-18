import { describe, expect, it } from "@jest/globals";
import { Constants } from "@tarragon/shared";
import { SPECIALIST_NOUN, specialistNoun } from "./specialist-noun";

describe("specialistNoun", () => {
  it("covers every live specialist_type value -- the same drift class as packages/shared/src/specialist-type-options.test.ts", () => {
    // Before genitourinary_medicine was added here, a referral letter
    // generated for that specialist type fell through to the raw-enum
    // fallback ("genitourinary medicine") instead of a real person-noun
    // phrase. Asserted against the generated Constants array (packages/
    // shared/src/database.types.ts), the same source of truth the DB
    // itself was built from, so a future ALTER TYPE ... ADD VALUE without
    // a matching entry here fails the build instead of silently degrading
    // a real clinical document.
    const liveValues = [...Constants.public.Enums.specialist_type].sort();
    expect(Object.keys(SPECIALIST_NOUN).sort()).toEqual(liveValues);
  });

  it("resolves every live value through the explicit map, not the raw-enum fallback", () => {
    for (const value of Constants.public.Enums.specialist_type) {
      expect(specialistNoun(value)).toBe(SPECIALIST_NOUN[value]);
    }
    // genitourinary_medicine is the one this fix added -- assert its fallback
    // ("genitourinary medicine", no person noun) is NOT what a real letter
    // would now print.
    expect(specialistNoun("genitourinary_medicine")).toBe("genitourinary medicine specialist");
    expect(specialistNoun("genitourinary_medicine")).not.toBe("genitourinary medicine");
  });

  it("falls back to a humanised, readable string for an unmapped value", () => {
    expect(specialistNoun("not_a_real_type")).toBe("not a real type");
  });
});
