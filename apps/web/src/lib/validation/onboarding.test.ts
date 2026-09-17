import { describe, expect, it } from "@jest/globals";
import { consentSchema, identityVerificationSchema } from "./onboarding";

describe("consentSchema", () => {
  it("accepts a plain acceptance with no onlyTypes restriction", () => {
    const result = consentSchema.safeParse({ accept: true });
    expect(result.success).toBe(true);
  });

  it("accepts an onlyTypes restriction of known consent types", () => {
    const result = consentSchema.safeParse({ accept: true, onlyTypes: ["terms_of_service"] });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognised consent type in onlyTypes", () => {
    const result = consentSchema.safeParse({ accept: true, onlyTypes: ["not_a_real_type"] });
    expect(result.success).toBe(false);
  });

  it("rejects accept: false", () => {
    const result = consentSchema.safeParse({ accept: false });
    expect(result.success).toBe(false);
  });
});

describe("identityVerificationSchema", () => {
  it("accepts a valid 11-digit NIN", () => {
    const result = identityVerificationSchema.safeParse({ method: "nin", idNumber: "12345678901" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid 11-digit BVN", () => {
    const result = identityVerificationSchema.safeParse({ method: "bvn", idNumber: "10987654321" });
    expect(result.success).toBe(true);
  });

  it("rejects a NIN that isn't 11 digits", () => {
    const result = identityVerificationSchema.safeParse({ method: "nin", idNumber: "12345" });
    expect(result.success).toBe(false);
  });

  it("accepts a document submission with a document type and reference number", () => {
    const result = identityVerificationSchema.safeParse({
      method: "document",
      idNumber: "A01234567",
      documentType: "passport",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a document submission with no document type", () => {
    const result = identityVerificationSchema.safeParse({
      method: "document",
      idNumber: "A01234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a document submission with an unrecognised document type", () => {
    const result = identityVerificationSchema.safeParse({
      method: "document",
      idNumber: "A01234567",
      documentType: "library_card",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a document submission with too short a reference number", () => {
    const result = identityVerificationSchema.safeParse({
      method: "document",
      idNumber: "A1",
      documentType: "passport",
    });
    expect(result.success).toBe(false);
  });

  it("does not require a document type for nin/bvn", () => {
    const result = identityVerificationSchema.safeParse({ method: "nin", idNumber: "12345678901" });
    expect(result.success).toBe(true);
  });
});
