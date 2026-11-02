import { describe, expect, it } from "@jest/globals";
import { ENQUIRY_CONSENT_VERSION, ENQUIRY_CONSENT_WORDING, parseLeadContact } from "./lead-consent";

describe("parseLeadContact", () => {
  it("accepts an email, lower-cased and trimmed", () => {
    expect(parseLeadContact("  Ada@Example.COM ")).toEqual({ email: "ada@example.com", phone: null });
  });
  it("turns a local Nigerian number into E.164", () => {
    expect(parseLeadContact("0803 123 4567")).toEqual({ email: null, phone: "+2348031234567" });
    expect(parseLeadContact("0701-234-5678")).toEqual({ email: null, phone: "+2347012345678" });
  });
  it("accepts a country-code number with or without the plus", () => {
    expect(parseLeadContact("2348031234567")).toEqual({ email: null, phone: "+2348031234567" });
    expect(parseLeadContact("+234 803 123 4567")).toEqual({ email: null, phone: "+2348031234567" });
  });
  it("accepts another country's E.164 number", () => {
    expect(parseLeadContact("+447911123456")).toEqual({ email: null, phone: "+447911123456" });
  });
  it("gives nothing for text that is neither", () => {
    for (const bad of ["", "hello", "a@b", "@x.com", "12345", "+0123456789", "08031234", "x".repeat(300) + "@a.com"]) {
      expect(parseLeadContact(bad)).toEqual({ email: null, phone: null });
    }
  });
});

describe("enquiry consent wording", () => {
  it("is versioned and says what is being agreed, in plain words", () => {
    expect(ENQUIRY_CONSENT_VERSION).toMatch(/^enquiry-consent-v\d+$/);
    expect(ENQUIRY_CONSENT_WORDING).toMatch(/email me about my enquiry/);
    expect(ENQUIRY_CONSENT_WORDING).toMatch(/stop at any time/);
    // the person is told where the details go
    expect(ENQUIRY_CONSENT_WORDING).toMatch(/HubSpot/);
    expect(ENQUIRY_CONSENT_WORDING).not.toMatch(/[–—]/);
  });
});
