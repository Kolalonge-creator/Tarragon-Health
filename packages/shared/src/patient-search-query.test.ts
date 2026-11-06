import { describe, expect, it } from "@jest/globals";
import { describePatientSearch, escapeLike, parsePatientSearchQuery, phoneStoredForms } from "./patient-search-query";

describe("parsePatientSearchQuery", () => {
  it("reads Tarragon numbers in the forms people type", () => {
    expect(parsePatientSearchQuery("TH-000123")).toEqual({ kind: "number", digits: "123", exact: "TH-000123" });
    expect(parsePatientSearchQuery("th 45")).toEqual({ kind: "number", digits: "45", exact: "TH-000045" });
    expect(parsePatientSearchQuery("123")).toEqual({ kind: "number", digits: "123", exact: "TH-000123" });
    expect(parsePatientSearchQuery("TH-1234567")).toEqual({ kind: "number", digits: "1234567", exact: "TH-1234567" });
    expect(parsePatientSearchQuery("TH-000")).toEqual({ kind: "number", digits: "0", exact: "TH-000000" });
  });
  it("converts Nigerian phone numbers to E.164", () => {
    expect(parsePatientSearchQuery("0803 123 4567")).toEqual({ kind: "phone", e164: "+2348031234567" });
    expect(parsePatientSearchQuery("+234 803-123-4567")).toEqual({ kind: "phone", e164: "+2348031234567" });
    expect(parsePatientSearchQuery("2348031234567")).toEqual({ kind: "phone", e164: "+2348031234567" });
    expect(parsePatientSearchQuery("8031234567")).toEqual({ kind: "phone", e164: "+2348031234567" });
  });
  it("treats a partial phone number as a fragment", () => {
    expect(parsePatientSearchQuery("1234567")).toEqual({ kind: "phone_fragment", digits: "1234567" });
    expect(parsePatientSearchQuery("0803123")).toEqual({ kind: "phone_fragment", digits: "803123" });
  });
  it("reads the start of a local mobile number as a phone, not a Tarragon number", () => {
    expect(parsePatientSearchQuery("0803")).toEqual({ kind: "phone_fragment", digits: "803" });
    expect(parsePatientSearchQuery("0123")).toEqual({ kind: "number", digits: "123", exact: "TH-000123" });
  });
  it("treats anything else as a name, trimmed and capped", () => {
    expect(parsePatientSearchQuery("  Ada Obi ")).toEqual({ kind: "name", text: "Ada Obi" });
    expect(parsePatientSearchQuery("x".repeat(300))).toEqual({ kind: "name", text: "x".repeat(100) });
    expect(parsePatientSearchQuery("")).toEqual({ kind: "empty" });
    expect(parsePatientSearchQuery(undefined)).toEqual({ kind: "empty" });
  });
  it("describes the search for the heading", () => {
    expect(describePatientSearch({ kind: "phone", e164: "+2348031234567" })).toBe("Phone: +2348031234567");
    expect(describePatientSearch({ kind: "empty" })).toBeNull();
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("50%_a\\b*")).toBe("50\\%\\_a\\\\b\\*");
  });
});

describe("phoneStoredForms", () => {
  it("covers E.164 and the two older stored forms", () => {
    expect(phoneStoredForms("+2348031234567")).toEqual(["+2348031234567", "2348031234567", "08031234567"]);
  });
});
