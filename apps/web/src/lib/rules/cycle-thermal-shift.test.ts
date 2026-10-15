import { FERTILE_WINDOW_LABEL } from "@tarragon/i18n";
import { THERMAL_SHIFT_DISCLAIMER } from "./cycle-thermal-shift";

describe("the temperature disclaimer (S85 D2)", () => {
  it("carries the exact label and never calls it a contraceptive method", () => {
    expect(THERMAL_SHIFT_DISCLAIMER).toContain(FERTILE_WINDOW_LABEL);
    expect(THERMAL_SHIFT_DISCLAIMER).toContain("Not contraception. This cannot prevent pregnancy.");
  });
});
