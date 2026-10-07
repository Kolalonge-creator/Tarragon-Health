import { formatYearsOfExperience } from "./format-years-of-experience";

describe("formatYearsOfExperience", () => {
  it("returns null for null and undefined, never a credential-shaped string", () => {
    expect(formatYearsOfExperience(null)).toBeNull();
    expect(formatYearsOfExperience(undefined)).toBeNull();
  });

  it("pluralises correctly", () => {
    expect(formatYearsOfExperience(0)).toBe("0 yrs experience");
    expect(formatYearsOfExperience(1)).toBe("1 yr experience");
    expect(formatYearsOfExperience(12)).toBe("12 yrs experience");
  });
});
