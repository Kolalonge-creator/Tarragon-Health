import { healthCheckView } from "./health-check-view";

describe("healthCheckView", () => {
  it("opens the named step", () => {
    expect(healthCheckView("wellbeing")).toBe("wellbeing");
    expect(healthCheckView("tests")).toBe("tests");
  });
  it("falls back to the overview for nothing, junk or a repeated parameter", () => {
    expect(healthCheckView(undefined)).toBe("overview");
    expect(healthCheckView("nope")).toBe("overview");
    expect(healthCheckView(["tests", "x"])).toBe("tests");
    expect(healthCheckView([])).toBe("overview");
  });
});
