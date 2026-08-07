import { bpControlRiskLevel } from "./bp-control-risk";

describe("bpControlRiskLevel", () => {
  it("is low at or above 80% control", () => {
    expect(bpControlRiskLevel(100)).toBe("low");
    expect(bpControlRiskLevel(80)).toBe("low");
  });

  it("is moderate from 60% up to (not including) 80%", () => {
    expect(bpControlRiskLevel(79)).toBe("moderate");
    expect(bpControlRiskLevel(60)).toBe("moderate");
  });

  it("is high from 40% up to (not including) 60%", () => {
    expect(bpControlRiskLevel(59)).toBe("high");
    expect(bpControlRiskLevel(40)).toBe("high");
  });

  it("is very_high below 40%", () => {
    expect(bpControlRiskLevel(39)).toBe("very_high");
    expect(bpControlRiskLevel(0)).toBe("very_high");
  });
});
