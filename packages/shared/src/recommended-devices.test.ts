import { describe, expect, it } from "@jest/globals";
import { connectionLabel, isListable, MANUAL_ENTRY_FIRST, validationLabel, type RecommendedDeviceRow } from "./recommended-devices";

const good: RecommendedDeviceRow = {
  active: true,
  clinically_reviewed: true,
  validation_standard: "validatebp",
  validation_reference: "ValidateBP entry, checked on a stated date",
  nafdac_status: "authorised_distributor",
  nafdac_registration_number: null,
  distributor_name: "Example distributor",
  bluetooth_via: "direct",
};

describe("recommended devices (C5)", () => {
  it("lists a validated model from an authorised distributor", () => {
    expect(isListable(good)).toBe(true);
  });
  it("refuses each missing criterion", () => {
    expect(isListable({ ...good, active: false })).toBe(false);
    expect(isListable({ ...good, clinically_reviewed: false })).toBe(false);
    expect(isListable({ ...good, validation_standard: null })).toBe(false);
    expect(isListable({ ...good, validation_reference: null })).toBe(false);
    expect(isListable({ ...good, nafdac_status: "unverified" })).toBe(false);
    expect(isListable({ ...good, distributor_name: "  " })).toBe(false);
    expect(isListable({ ...good, distributor_name: null })).toBe(false);
  });
  it("a NAFDAC-registered model needs its registration number", () => {
    expect(isListable({ ...good, nafdac_status: "registered", nafdac_registration_number: null })).toBe(false);
    expect(isListable({ ...good, nafdac_status: "registered", nafdac_registration_number: "A7-0000" })).toBe(true);
  });
  it("labels connection and validation, and falls back to manual entry for an unknown value", () => {
    expect(connectionLabel("direct")).toMatch(/Bluetooth/);
    expect(connectionLabel("something_new")).toMatch(/Type the reading in/);
    expect(validationLabel("validatebp")).toMatch(/ValidateBP/);
    expect(validationLabel(null)).toBeNull();
  });
  it("puts manual entry first and never mentions a price or a purchase", () => {
    expect(MANUAL_ENTRY_FIRST).toMatch(/do not need a device/);
    expect(MANUAL_ENTRY_FIRST).not.toMatch(/buy|price|₦|naira|free healthcare|your doctor/i);
  });
});
