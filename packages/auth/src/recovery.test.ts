import { describe, expect, it } from "@jest/globals";
import {
  classifyRecoveryIdentifier,
  formatBackupCode,
  formatLagosDateTime,
  interpretPhoneRecoveryHold,
  normaliseBackupCode,
} from "./recovery";

describe("interpretPhoneRecoveryHold fails closed", () => {
  it("is clear only when the database says held:false", () => {
    expect(interpretPhoneRecoveryHold({ held: false }, null)).toEqual({ status: "clear" });
    expect(interpretPhoneRecoveryHold({ held: false, released_by_contact: true }, null)).toEqual({ status: "clear" });
  });
  it("carries the date when held", () => {
    expect(interpretPhoneRecoveryHold({ held: true, until: "2026-10-16T17:30:00Z" }, null)).toEqual({ status: "held", until: "2026-10-16T17:30:00Z" });
  });
  it("treats an error, an empty answer, a malformed answer and a held answer with no date as unknown, never clear", () => {
    expect(interpretPhoneRecoveryHold(null, { message: "boom" })).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold(null, null)).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold("held", null)).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold({}, null)).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold({ held: "false" }, null)).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold({ held: true }, null)).toEqual({ status: "unknown" });
    expect(interpretPhoneRecoveryHold({ held: true, until: "soon" }, null)).toEqual({ status: "unknown" });
  });
});

describe("formatLagosDateTime", () => {
  it("shows Lagos wall-clock time (UTC+1, no daylight saving)", () => {
    expect(formatLagosDateTime("2026-10-16T17:30:00Z")).toBe("16 Oct 2026, 18:30");
    expect(formatLagosDateTime("2026-12-31T23:30:00Z")).toBe("1 Jan 2027, 00:30");
  });
  it("returns an empty string for a bad date rather than throwing", () => {
    expect(formatLagosDateTime("nope")).toBe("");
  });
});

describe("classifyRecoveryIdentifier", () => {
  it("reads an address as an email and lower-cases it", () => {
    expect(classifyRecoveryIdentifier("  Ada@Example.NG ")).toEqual({ ok: true, kind: "email", value: "ada@example.ng" });
  });
  it("reads every way of typing a Nigerian number the same way", () => {
    for (const typed of ["0803 123 4567", "08031234567", "2348031234567", "+234 803 123 4567", "+2340803 123 4567"]) {
      expect(classifyRecoveryIdentifier(typed)).toEqual({ ok: true, kind: "phone", value: "+2348031234567" });
    }
  });
  it("refuses an empty box, an odd address and text that is not a number", () => {
    for (const bad of ["", "   ", "ada@", "@example.ng", "a b@example.ng", "hello", "12345", "x".repeat(300)]) {
      expect(classifyRecoveryIdentifier(bad)).toEqual({ ok: false });
    }
  });
});

describe("normaliseBackupCode", () => {
  it("treats case, dashes and spaces as formatting", () => {
    for (const typed of ["abcde-fghjk", "ABCDE FGHJK", "abcdefghjk", " ABCDE-FGHJK "]) {
      expect(normaliseBackupCode(typed)).toBe("ABCDEFGHJK");
    }
  });
  it("refuses the wrong length and the symbols the database never draws (0 O 1 I)", () => {
    for (const bad of ["", "ABCDE", "ABCDEFGHJKL", "ABCDE-FGHJ0", "ABCDE-FGHJO", "ABCDE-FGHJ1", "ABCDE-FGHJI"]) {
      expect(normaliseBackupCode(bad)).toBeNull();
    }
  });
  it("formats as two groups of five", () => {
    expect(formatBackupCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});
