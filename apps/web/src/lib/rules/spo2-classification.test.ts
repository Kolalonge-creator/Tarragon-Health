import { classifySpo2Level } from "./spo2-classification";

describe("classifySpo2Level (must match private.classify_spo2_level)", () => {
  it("EMERGENCY below 90%", () => {
    expect(classifySpo2Level(89)).toBe("emergency");
    expect(classifySpo2Level(70)).toBe("emergency");
  });

  it("RED band 90-92%", () => {
    expect(classifySpo2Level(90)).toBe("red");
    expect(classifySpo2Level(92)).toBe("red");
  });

  it("AMBER band 93-94%", () => {
    expect(classifySpo2Level(93)).toBe("amber");
    expect(classifySpo2Level(94)).toBe("amber");
  });

  it("GREEN at or above 95%", () => {
    expect(classifySpo2Level(95)).toBe("green");
    expect(classifySpo2Level(100)).toBe("green");
  });

  it("returns unknown on missing value", () => {
    expect(classifySpo2Level(null)).toBe("unknown");
    expect(classifySpo2Level(undefined)).toBe("unknown");
  });
});
