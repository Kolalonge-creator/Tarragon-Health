import { parseScheduleSpec } from "./schedule";
import { SPEC_VALIDITY_CASES } from "./schedule.fixtures";

describe("schedule spec validity (shared with the database check)", () => {
  it.each(SPEC_VALIDITY_CASES)("$name", ({ spec, valid }) => {
    expect(parseScheduleSpec(spec).ok).toBe(valid);
  });

  it("has both accepted and refused cases", () => {
    expect(SPEC_VALIDITY_CASES.some((c) => c.valid)).toBe(true);
    expect(SPEC_VALIDITY_CASES.filter((c) => !c.valid).length).toBeGreaterThan(30);
  });
});
