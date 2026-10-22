import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_MEASUREMENT_UNITS,
  formatLength,
  formatTemperature,
  formatWeight,
  lengthFromCm,
  lengthToCm,
  measurementUnitsFromProfile,
  roundForStorage,
  temperatureFromC,
  temperatureToC,
  weightFromKg,
  weightToKg,
} from "./measurement-units";

describe("measurement units", () => {
  it("converts weight both ways", () => {
    expect(weightFromKg(70, "kg")).toBe(70);
    expect(weightFromKg(70, "lb")).toBeCloseTo(154.32, 2);
    expect(weightToKg(154.3, "lb")).toBeCloseTo(69.99, 1);
    expect(roundForStorage(weightToKg(154.3, "lb"), 1)).toBe(70);
  });

  it("converts temperature both ways, with the fixed points right", () => {
    expect(temperatureFromC(37, "c")).toBe(37);
    expect(temperatureFromC(37, "f")).toBeCloseTo(98.6, 5);
    expect(temperatureFromC(0, "f")).toBe(32);
    expect(temperatureToC(98.6, "f")).toBeCloseTo(37, 5);
    expect(temperatureToC(212, "f")).toBe(100);
  });

  it("converts length both ways", () => {
    expect(lengthFromCm(254, "in")).toBeCloseTo(100, 5);
    expect(lengthToCm(70, "in")).toBeCloseTo(177.8, 5);
  });

  it("round-trips a stored value through the display unit within entry precision", () => {
    for (const kg of [45.5, 70, 112.3]) {
      expect(roundForStorage(weightToKg(Number(weightFromKg(kg, "lb").toFixed(1)), "lb"), 1)).toBeCloseTo(kg, 0);
    }
  });

  it("formats with the unit and never invents a number", () => {
    expect(formatWeight(70, "kg")).toBe("70.0 kg");
    expect(formatWeight(70, "lb")).toBe("154.3 lb");
    expect(formatTemperature(36.65, "c")).toBe("36.7 °C");
    expect(formatTemperature(37, "f")).toBe("98.6 °F");
    expect(formatLength(88.2, "cm")).toBe("88 cm");
    expect(formatLength(88.9, "in")).toBe("35 in");
    expect(formatWeight(70, "lb", false)).toBe("154.3");
    expect(formatWeight(null, "kg")).toBeNull();
    expect(formatTemperature(Number.NaN, "c")).toBeNull();
    expect(formatLength(undefined, "cm")).toBeNull();
  });

  it("falls back to the defaults for a missing profile or junk values", () => {
    expect(measurementUnitsFromProfile(null)).toEqual(DEFAULT_MEASUREMENT_UNITS);
    expect(measurementUnitsFromProfile({ weight_display_unit: "stone", temperature_display_unit: 3 })).toEqual(DEFAULT_MEASUREMENT_UNITS);
    expect(measurementUnitsFromProfile({ weight_display_unit: "lb", temperature_display_unit: "f", length_display_unit: "in" })).toEqual({
      weight: "lb",
      temperature: "f",
      length: "in",
    });
  });
});
