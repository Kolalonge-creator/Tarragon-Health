import { scoreSexualHealthScreen } from "./sexual-health-scoring";

describe("scoreSexualHealthScreen — iief5 (1-5 per item, higher = better)", () => {
  it("bands a high total (least concern) as none_minimal", () => {
    expect(scoreSexualHealthScreen("iief5", [5, 5, 5, 5, 5]).severityBand).toBe("none_minimal"); // 25
    expect(scoreSexualHealthScreen("iief5", [5, 5, 5, 5, 1]).severityBand).toBe("none_minimal"); // 21
  });

  it("bands a mid-high total as mild", () => {
    expect(scoreSexualHealthScreen("iief5", [5, 5, 5, 4, 1]).severityBand).toBe("mild"); // 20
    expect(scoreSexualHealthScreen("iief5", [3, 3, 3, 3, 3]).severityBand).toBe("mild"); // 15
  });

  it("bands a mid-low total as moderate", () => {
    expect(scoreSexualHealthScreen("iief5", [3, 3, 3, 3, 2]).severityBand).toBe("moderate"); // 14
    expect(scoreSexualHealthScreen("iief5", [1, 2, 2, 2, 2]).severityBand).toBe("moderate"); // 9
  });

  it("bands a low total (most concern) as severe", () => {
    expect(scoreSexualHealthScreen("iief5", [1, 1, 2, 2, 2]).severityBand).toBe("severe"); // 8
    expect(scoreSexualHealthScreen("iief5", [1, 1, 1, 1, 1]).severityBand).toBe("severe"); // 5
  });

  it("sets cardiometabolicFlag only at moderate/severe", () => {
    expect(scoreSexualHealthScreen("iief5", [5, 5, 5, 5, 5]).cardiometabolicFlag).toBe(false); // none_minimal
    expect(scoreSexualHealthScreen("iief5", [3, 3, 3, 3, 3]).cardiometabolicFlag).toBe(false); // mild
    expect(scoreSexualHealthScreen("iief5", [3, 3, 3, 3, 2]).cardiometabolicFlag).toBe(true); // moderate
    expect(scoreSexualHealthScreen("iief5", [1, 1, 1, 1, 1]).cardiometabolicFlag).toBe(true); // severe
  });

  it("rejects malformed input", () => {
    expect(() => scoreSexualHealthScreen("iief5", [1, 1, 1])).toThrow();
    expect(() => scoreSexualHealthScreen("iief5", [0, 1, 1, 1, 1])).toThrow(); // 0 is out of 1-5 range
  });
});

describe("scoreSexualHealthScreen — libido_brief (1-5 per item, higher = better)", () => {
  it("shares iief5's bands but never sets cardiometabolicFlag", () => {
    expect(scoreSexualHealthScreen("libido_brief", [1, 1, 1, 1, 1]).severityBand).toBe("severe"); // 5
    expect(scoreSexualHealthScreen("libido_brief", [1, 1, 1, 1, 1]).cardiometabolicFlag).toBe(false);
    expect(scoreSexualHealthScreen("libido_brief", [3, 3, 3, 3, 2]).severityBand).toBe("moderate"); // 14
    expect(scoreSexualHealthScreen("libido_brief", [3, 3, 3, 3, 2]).cardiometabolicFlag).toBe(false);
  });
});

describe("scoreSexualHealthScreen — fsfi_pain (0-5 per item, higher = worse)", () => {
  it("bands a low total (least concern) as none_minimal", () => {
    expect(scoreSexualHealthScreen("fsfi_pain", [0, 0, 0, 0, 0]).severityBand).toBe("none_minimal"); // 0
    expect(scoreSexualHealthScreen("fsfi_pain", [1, 1, 1, 1, 1]).severityBand).toBe("none_minimal"); // 5
  });

  it("bands a mid-low total as mild", () => {
    expect(scoreSexualHealthScreen("fsfi_pain", [2, 1, 1, 1, 1]).severityBand).toBe("mild"); // 6
    expect(scoreSexualHealthScreen("fsfi_pain", [3, 3, 2, 2, 2]).severityBand).toBe("mild"); // 12
  });

  it("bands a mid-high total as moderate", () => {
    expect(scoreSexualHealthScreen("fsfi_pain", [3, 3, 3, 2, 2]).severityBand).toBe("moderate"); // 13
    expect(scoreSexualHealthScreen("fsfi_pain", [4, 4, 4, 4, 4]).severityBand).toBe("moderate"); // 20
  });

  it("bands a high total (most concern) as severe", () => {
    expect(scoreSexualHealthScreen("fsfi_pain", [5, 4, 4, 4, 4]).severityBand).toBe("severe"); // 21
    expect(scoreSexualHealthScreen("fsfi_pain", [5, 5, 5, 5, 5]).severityBand).toBe("severe"); // 25
  });

  it("never sets cardiometabolicFlag, even at severe", () => {
    expect(scoreSexualHealthScreen("fsfi_pain", [5, 5, 5, 5, 5]).cardiometabolicFlag).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(() => scoreSexualHealthScreen("fsfi_pain", [1, 1, 1, 1])).toThrow();
    expect(() => scoreSexualHealthScreen("fsfi_pain", [6, 1, 1, 1, 1])).toThrow(); // 6 is out of 0-5 range
  });
});

describe("scoreSexualHealthScreen — pe_diagnostic_tool (0-5 per item, higher = worse)", () => {
  it("shares fsfi_pain's bands but never sets cardiometabolicFlag", () => {
    expect(scoreSexualHealthScreen("pe_diagnostic_tool", [5, 5, 5, 5, 5]).severityBand).toBe("severe"); // 25
    expect(scoreSexualHealthScreen("pe_diagnostic_tool", [5, 5, 5, 5, 5]).cardiometabolicFlag).toBe(
      false
    );
    expect(scoreSexualHealthScreen("pe_diagnostic_tool", [0, 0, 0, 0, 0]).severityBand).toBe(
      "none_minimal"
    );
  });
});
