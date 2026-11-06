import { describe, expect, it } from "@jest/globals";
import { identityLine } from "./identity-line";

const NOW = new Date("2026-11-06T12:00:00Z");

describe("identityLine", () => {
  it("shows date of birth with calendar age, then sex", () => {
    expect(identityLine("1970-09-03", "female", NOW)).toMatch(/^DOB .*1970 \(56\), female$/);
  });
  it("does not add a year before the birthday", () => {
    expect(identityLine("2008-11-07", null, NOW)).toMatch(/\(17\)$/);
  });
  it("keeps whatever is known and is null when nothing is", () => {
    expect(identityLine(null, "male", NOW)).toBe("male");
    expect(identityLine("bad", null, NOW)).toBeNull();
    expect(identityLine(null, null, NOW)).toBeNull();
  });
});
