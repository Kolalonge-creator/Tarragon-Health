import { friendlyDbError, isFeatureConsentError } from "./feature-consent-error";

describe("friendlyDbError (S47d)", () => {
  it("turns the database refusal into a plain sentence and never shows the code", () => {
    for (const type of ["reproductive", "mental_health", "device_data"]) {
      const out = friendlyDbError(`consent_required:${type}`);
      expect(out).not.toContain("consent_required");
      expect(out.length).toBeGreaterThan(20);
      expect(isFeatureConsentError(`consent_required:${type}`)).toBe(true);
    }
  });

  it("leaves every other message alone", () => {
    expect(friendlyDbError("duplicate key value")).toBe("duplicate key value");
    expect(friendlyDbError(undefined)).toBe("");
    expect(isFeatureConsentError("duplicate key value")).toBe(false);
  });
});
