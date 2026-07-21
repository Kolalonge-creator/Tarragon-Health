import {
  scorePhq9,
  scoreGad7,
  scoreAuditC,
} from "./mental-health-screening";

describe("scorePhq9", () => {
  it("bands totals correctly", () => {
    expect(scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 0]).band).toBe("minimal");
    expect(scorePhq9([1, 1, 1, 1, 1, 0, 0, 0, 0]).band).toBe("mild"); // 5
    expect(scorePhq9([2, 2, 2, 2, 2, 0, 0, 0, 0]).band).toBe("moderate"); // 10
    expect(scorePhq9([2, 2, 2, 2, 2, 2, 2, 1, 0]).band).toBe("moderately_severe"); // 15
    expect(scorePhq9([3, 3, 3, 3, 3, 3, 2, 0, 0]).band).toBe("severe"); // 20
  });

  it("flags a crisis only when the self-harm item (9) is non-zero", () => {
    expect(scorePhq9([3, 3, 3, 0, 0, 0, 0, 0, 0]).crisis).toBe(false);
    expect(scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 1]).crisis).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(() => scorePhq9([0, 0, 0])).toThrow();
    expect(() => scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 4])).toThrow();
  });
});

describe("scoreGad7", () => {
  it("bands totals correctly", () => {
    expect(scoreGad7([0, 0, 0, 0, 0, 0, 0]).band).toBe("minimal");
    expect(scoreGad7([1, 1, 1, 1, 1, 0, 0]).band).toBe("mild"); // 5
    expect(scoreGad7([2, 2, 2, 2, 2, 0, 0]).band).toBe("moderate"); // 10
    expect(scoreGad7([3, 3, 3, 3, 3, 0, 0]).band).toBe("severe"); // 15
  });
});

describe("scoreAuditC", () => {
  it("applies the sex-specific hazardous cut-off", () => {
    // Total 3: hazardous for women (≥3), not for men (≥4).
    expect(scoreAuditC([1, 1, 1], "female").hazardous).toBe(true);
    expect(scoreAuditC([1, 1, 1], "male").hazardous).toBe(false);
    // Unknown sex uses the cautious ≥3.
    expect(scoreAuditC([1, 1, 1], null).hazardous).toBe(true);
  });

  it("bands by score", () => {
    expect(scoreAuditC([0, 0, 0], "male").band).toBe("low_risk");
    expect(scoreAuditC([2, 2, 1], "male").band).toBe("increasing_risk"); // 5
    expect(scoreAuditC([4, 4, 4], "male").band).toBe("higher_risk"); // 12
  });
});
