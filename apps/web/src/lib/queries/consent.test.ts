import { currentConsentStatus, isCurrentlyWithdrawn, type PatientConsent } from "./consent";

/**
 * Mirrors private.has_required_consents' "most recent row per consent_type
 * wins" logic (20260829092000_patient_consent_withdrawal.sql) — see that
 * migration's DB proof test (packages/db/tests/patient_consent_withdrawal.sql)
 * for the same cases asserted against the actual trigger/function.
 */

function row(overrides: Partial<PatientConsent>): PatientConsent {
  return {
    id: overrides.id ?? "row",
    organisation_id: "org",
    patient_id: "patient",
    consent_type: "terms_of_service",
    consent_version_id: "v1",
    version: "v1",
    action: "accepted",
    accepted_at: "2026-08-01T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("currentConsentStatus", () => {
  it("returns nothing for a type never seen", () => {
    expect(currentConsentStatus([]).get("terms_of_service")).toBeUndefined();
  });

  it("takes the only event when there is one", () => {
    const accepted = row({ created_at: "2026-08-01T00:00:00Z" });
    expect(currentConsentStatus([accepted]).get("terms_of_service")).toBe(accepted);
  });

  it("takes the most recent event, regardless of array order", () => {
    const earlier = row({ id: "a", created_at: "2026-08-01T00:00:00Z", action: "accepted" });
    const later = row({ id: "b", created_at: "2026-08-05T00:00:00Z", action: "withdrawn" });
    expect(currentConsentStatus([later, earlier]).get("terms_of_service")).toBe(later);
    expect(currentConsentStatus([earlier, later]).get("terms_of_service")).toBe(later);
  });

  it("tracks each consent_type independently", () => {
    const tos = row({ id: "a", consent_type: "terms_of_service" });
    const dp = row({ id: "b", consent_type: "data_processing" });
    const status = currentConsentStatus([tos, dp]);
    expect(status.get("terms_of_service")).toBe(tos);
    expect(status.get("data_processing")).toBe(dp);
  });
});

describe("isCurrentlyWithdrawn", () => {
  it("is false with no history", () => {
    expect(isCurrentlyWithdrawn([], "terms_of_service")).toBe(false);
  });

  it("is false after only an acceptance", () => {
    const events = [row({ action: "accepted", created_at: "2026-08-01T00:00:00Z" })];
    expect(isCurrentlyWithdrawn(events, "terms_of_service")).toBe(false);
  });

  it("is true after a later withdrawal", () => {
    const events = [
      row({ id: "a", action: "accepted", created_at: "2026-08-01T00:00:00Z" }),
      row({ id: "b", action: "withdrawn", created_at: "2026-08-05T00:00:00Z" }),
    ];
    expect(isCurrentlyWithdrawn(events, "terms_of_service")).toBe(true);
  });

  it("is false again after re-accepting following a withdrawal", () => {
    const events = [
      row({ id: "a", action: "accepted", created_at: "2026-08-01T00:00:00Z" }),
      row({ id: "b", action: "withdrawn", created_at: "2026-08-05T00:00:00Z" }),
      row({ id: "c", action: "accepted", created_at: "2026-08-10T00:00:00Z" }),
    ];
    expect(isCurrentlyWithdrawn(events, "terms_of_service")).toBe(false);
  });
});
