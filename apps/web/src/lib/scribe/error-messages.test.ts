import { scribeErrorMessage } from "./error-messages";

describe("scribeErrorMessage", () => {
  it("explains a consent problem plainly", () => {
    for (const code of ["consent_not_active", "consent_encounter_mismatch", "consent_not_found"]) {
      expect(scribeErrorMessage(new Error(code))).toMatch(/consent/i);
    }
    expect(scribeErrorMessage(new Error("Scribe consent is not active for this encounter."))).toMatch(/consent/i);
  });

  it("never shows a raw code for anything else", () => {
    for (const code of ["model_call_failed", "audit_unavailable", "invalid_input", "unparseable_response"]) {
      const text = scribeErrorMessage(new Error(code));
      expect(text).not.toContain(code);
      expect(text).toMatch(/manually/i);
    }
    expect(scribeErrorMessage("weird")).toMatch(/manually/i);
  });
});
