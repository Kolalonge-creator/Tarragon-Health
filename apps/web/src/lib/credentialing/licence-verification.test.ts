import { describe, expect, it } from "@jest/globals";
import { licenceVerificationSchema, toVerificationRpcArgs } from "./licence-verification";

const staff = "6b1d3f0e-8f7a-4c1e-9a0b-2f7d8c5e4a11";
const doc = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("licenceVerificationSchema", () => {
  it("accepts a good-standing check with evidence", () => {
    const parsed = licenceVerificationSchema.parse({ staffId: staff, folio: "MDCN/12345", result: "good_standing", evidenceDocumentId: doc, notes: "" });
    expect(toVerificationRpcArgs(parsed)).toEqual({
      p_staff: staff,
      p_folio: "MDCN/12345",
      p_register_result: "good_standing",
      p_evidence_document: doc,
      p_notes: null,
    });
  });

  it("needs evidence or a written note", () => {
    const r = licenceVerificationSchema.safeParse({ staffId: staff, folio: "MDCN/1", result: "good_standing", evidenceDocumentId: null, notes: "short" });
    expect(r.success).toBe(false);
    const ok = licenceVerificationSchema.safeParse({ staffId: staff, folio: "MDCN/1", result: "not_found", evidenceDocumentId: null, notes: "Searched by name and folio on the register" });
    expect(ok.success).toBe(true);
  });

  it("refuses an unknown register result and a missing folio", () => {
    expect(licenceVerificationSchema.safeParse({ staffId: staff, folio: "x", result: "good_standing", evidenceDocumentId: doc, notes: null }).success).toBe(false);
    expect(licenceVerificationSchema.safeParse({ staffId: staff, folio: "MDCN/1", result: "fine", evidenceDocumentId: doc, notes: null }).success).toBe(false);
  });
});
