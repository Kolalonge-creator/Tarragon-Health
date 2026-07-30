import { describe, expect, it } from "vitest";
import {
  bpDeviceMissingArmCircumference,
  computeDeviceValidation,
  type ValidatedDeviceListEntry,
} from "./devices";

const validatedList: ValidatedDeviceListEntry[] = [
  { make: "Omron", model: "HEM-7120", deviceKind: "bp" },
  { make: "Accu-Chek", model: "Guide", deviceKind: "glucose_fasting" },
];

describe("computeDeviceValidation (spec §5.4)", () => {
  it("is_wrist=true is always wrist_advisory, even for an otherwise validated make/model", () => {
    const result = computeDeviceValidation(
      {
        isWrist: true,
        make: "Omron",
        model: "HEM-7120",
        deviceKind: "bp",
        approxAgeYears: 1,
      },
      validatedList,
    );
    expect(result).toBe("wrist_advisory");
  });

  it("a make/model absent from the validated list is unvalidated_advisory", () => {
    const result = computeDeviceValidation(
      {
        isWrist: false,
        make: "GenericBrand",
        model: "XYZ-100",
        deviceKind: "bp",
        approxAgeYears: 1,
      },
      validatedList,
    );
    expect(result).toBe("unvalidated_advisory");
  });

  it("a validated make/model older than 4 years is unvalidated_advisory", () => {
    const result = computeDeviceValidation(
      {
        isWrist: false,
        make: "Omron",
        model: "HEM-7120",
        deviceKind: "bp",
        approxAgeYears: 5,
      },
      validatedList,
    );
    expect(result).toBe("unvalidated_advisory");
  });

  it("a validated make/model at exactly 4 years is still validated (only > 4 triggers advisory)", () => {
    const result = computeDeviceValidation(
      {
        isWrist: false,
        make: "Omron",
        model: "HEM-7120",
        deviceKind: "bp",
        approxAgeYears: 4,
      },
      validatedList,
    );
    expect(result).toBe("validated");
  });

  it("a validated make/model with unknown age is validated", () => {
    const result = computeDeviceValidation(
      {
        isWrist: false,
        make: "Omron",
        model: "HEM-7120",
        deviceKind: "bp",
        approxAgeYears: null,
      },
      validatedList,
    );
    expect(result).toBe("validated");
  });

  it("the same make/model under a different device_kind is not considered validated for this kind", () => {
    const result = computeDeviceValidation(
      {
        isWrist: false,
        make: "Omron",
        model: "HEM-7120",
        deviceKind: "glucose_fasting",
        approxAgeYears: 1,
      },
      validatedList,
    );
    expect(result).toBe("unvalidated_advisory");
  });
});

describe("bpDeviceMissingArmCircumference (spec §5.4)", () => {
  it("flags a BP cuff with no arm circumference captured", () => {
    expect(bpDeviceMissingArmCircumference("bp", null)).toBe(true);
  });

  it("does not flag a BP cuff once arm circumference is captured", () => {
    expect(bpDeviceMissingArmCircumference("bp", 28.5)).toBe(false);
  });

  it("does not apply to non-BP device kinds", () => {
    expect(bpDeviceMissingArmCircumference("weight", null)).toBe(false);
  });
});
