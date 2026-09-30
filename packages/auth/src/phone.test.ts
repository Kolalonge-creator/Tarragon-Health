import { describe, expect, it } from "@jest/globals";
import { maskPhone, normalisePhone, normalisePhoneWithCountry } from "./phone";

const NG = "+2348031234567";

describe("normalisePhone (Nigerian formats)", () => {
  it.each([
    "08031234567",
    "0803 123 4567",
    "0803-123-4567",
    "8031234567",
    "2348031234567",
    "+2348031234567",
    "+234 803 123 4567",
    "002348031234567",
    "+2340803 123 4567", // stray zero after the country code
    "(0803) 123 4567",
  ])("%s -> %s", (input) => {
    expect(normalisePhone(input)).toEqual({ ok: true, e164: NG, country: "NG" });
  });

  it("accepts every Nigerian mobile prefix family (070, 080, 081, 090, 091)", () => {
    for (const p of ["07012345678", "08012345678", "08112345678", "09012345678", "09112345678"]) {
      expect(normalisePhone(p).ok).toBe(true);
    }
  });

  it("rejects numbers that would send a code to the wrong person", () => {
    for (const bad of ["0603123456", "080312345", "080312345678", "2348031234", "+234", "12345", "0"]) {
      expect(normalisePhone(bad).ok).toBe(false);
    }
  });

  it("does not guess a country for an ambiguous bare number", () => {
    expect(normalisePhone("12345678901").ok).toBe(false);
  });

  it("rejects letters and empty input with distinct reasons", () => {
    expect(normalisePhone("")).toEqual({ ok: false, reason: "empty" });
    expect(normalisePhone("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalisePhone("0803abc4567")).toEqual({ ok: false, reason: "invalid_characters" });
  });

  it("passes a valid non-Nigerian international number through unchanged", () => {
    expect(normalisePhone("+44 7700 900123")).toEqual({ ok: true, e164: "+447700900123", country: "other" });
    expect(normalisePhone("+1 415 555 2671")).toEqual({ ok: true, e164: "+14155552671", country: "other" });
  });
});

describe("normalisePhoneWithCountry", () => {
  it("routes +234 through the Nigerian rules, including a leading zero", () => {
    expect(normalisePhoneWithCountry("+234", "0803 123 4567")).toEqual({ ok: true, e164: NG, country: "NG" });
    expect(normalisePhoneWithCountry("+234", "8031234567")).toEqual({ ok: true, e164: NG, country: "NG" });
  });
  it("concatenates other countries and validates as E.164", () => {
    expect(normalisePhoneWithCountry("+44", "7700 900123")).toEqual({ ok: true, e164: "+447700900123", country: "other" });
    expect(normalisePhoneWithCountry("+44", "12").ok).toBe(false);
    expect(normalisePhoneWithCountry("+44", "").ok).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps only the last four digits", () => {
    expect(maskPhone(NG)).toBe("+234 *** *** 4567");
    expect(maskPhone(NG)).not.toContain("803123");
  });
  it("never echoes a short or junk value", () => {
    expect(maskPhone("123")).toBe("***");
  });
});
