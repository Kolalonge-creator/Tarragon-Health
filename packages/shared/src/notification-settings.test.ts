import { describe, expect, it } from "@jest/globals";
import { DEFAULT_SETTINGS, fromRow, normaliseTime, validateSettings } from "./notification-settings";

describe("settings helpers", () => {
  it("normalises times", () => {
    expect(normaliseTime("7:5")).toBe("07:05");
    expect(normaliseTime("07:05:00")).toBe("07:05");
    expect(normaliseTime(" 22:30 ")).toBe("22:30");
    for (const bad of ["24:00", "12:60", "abc", "", "7"]) expect(normaliseTime(bad)).toBeNull();
  });
  it("needs two valid, different times", () => {
    const ok = { ...DEFAULT_SETTINGS };
    expect(validateSettings(ok)).toBeNull();
    expect(validateSettings({ ...ok, quietEnd: ok.quietStart })).toBe("times");
    expect(validateSettings({ ...ok, quietStart: "25:00" })).toBe("times");
    expect(validateSettings({ ...ok, quietEnd: "x" })).toBe("times");
  });
  it("builds a form value from a row, or the defaults", () => {
    expect(fromRow(null, null)).toEqual(DEFAULT_SETTINGS);
    expect(fromRow({ quiet_enabled: false, quiet_start: "22:00:00", quiet_end: "06:30:00" }, true))
      .toEqual({ quietEnabled: false, quietStart: "22:00", quietEnd: "06:30", discreet: true });
    expect(fromRow({ quiet_enabled: true, quiet_start: "bad", quiet_end: "bad" }, undefined))
      .toEqual(DEFAULT_SETTINGS);
  });
});
