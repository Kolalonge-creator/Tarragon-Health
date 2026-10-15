import { describe, expect, it } from "@jest/globals";
import { checkAdultDateOfBirth, parseIsoDate } from "./adult-registration";

const TODAY = new Date(Date.UTC(2026, 9, 13)); // 13 October 2026

describe("checkAdultDateOfBirth", () => {
  it("accepts someone exactly 18 today", () => {
    expect(checkAdultDateOfBirth("2008-10-13", TODAY)).toBe("adult");
  });
  it("refuses someone whose 18th birthday is tomorrow", () => {
    expect(checkAdultDateOfBirth("2008-10-14", TODAY)).toBe("under_age");
  });
  it("accepts a clear adult and refuses a child", () => {
    expect(checkAdultDateOfBirth("1985-03-02", TODAY)).toBe("adult");
    expect(checkAdultDateOfBirth("2015-01-01", TODAY)).toBe("under_age");
  });
  it("refuses a date in the future", () => {
    expect(checkAdultDateOfBirth("2030-01-01", TODAY)).toBe("under_age");
  });
  it("rejects dates that are not real", () => {
    expect(checkAdultDateOfBirth("2001-02-30", TODAY)).toBe("invalid");
    expect(checkAdultDateOfBirth("13/10/1990", TODAY)).toBe("invalid");
    expect(checkAdultDateOfBirth("", TODAY)).toBe("invalid");
    expect(checkAdultDateOfBirth("1850-01-01", TODAY)).toBe("invalid");
  });
  it("handles a 29 February birthday", () => {
    expect(checkAdultDateOfBirth("2008-02-29", TODAY)).toBe("adult");
    expect(parseIsoDate("2007-02-29")).toBeNull();
  });
});
