import { classifyTemperatureLevel } from "./temperature-classification";

describe("classifyTemperatureLevel (must match private.classify_temperature_level)", () => {
  it("EMERGENCY at or above 40.0C", () => {
    expect(classifyTemperatureLevel(40.0)).toBe("emergency");
    expect(classifyTemperatureLevel(41.5)).toBe("emergency");
  });

  it("EMERGENCY below 35.0C", () => {
    expect(classifyTemperatureLevel(34.9)).toBe("emergency");
    expect(classifyTemperatureLevel(30.0)).toBe("emergency");
  });

  it("RED band 39.0-39.9C", () => {
    expect(classifyTemperatureLevel(39.0)).toBe("red");
    expect(classifyTemperatureLevel(39.9)).toBe("red");
  });

  it("AMBER band 38.0-38.9C", () => {
    expect(classifyTemperatureLevel(38.0)).toBe("amber");
    expect(classifyTemperatureLevel(38.9)).toBe("amber");
  });

  it("GREEN between 35.0C and 37.9C", () => {
    expect(classifyTemperatureLevel(35.0)).toBe("green");
    expect(classifyTemperatureLevel(37.0)).toBe("green");
    expect(classifyTemperatureLevel(37.9)).toBe("green");
  });

  it("returns unknown on missing value", () => {
    expect(classifyTemperatureLevel(null)).toBe("unknown");
    expect(classifyTemperatureLevel(undefined)).toBe("unknown");
  });
});
