import { isLocalSupabase, isMfaEnrolmentExemptPath, staffMustEnrolMfa } from "./mfa-policy";

const PROD = "https://koiplnmbgnqnbywhpjlf.supabase.co";

describe("staffMustEnrolMfa", () => {
  it("requires a factor for every non-patient role that has none", () => {
    for (const role of ["admin", "clinician", "care_coordinator", "finance", "analyst", "pharmacist", "lab_partner"] as const) {
      expect(staffMustEnrolMfa(role, "aal1", PROD)).toBe(true);
    }
  });

  it("lets staff through once a factor is verified (nextLevel aal2)", () => {
    expect(staffMustEnrolMfa("clinician", "aal2", PROD)).toBe(false);
    expect(staffMustEnrolMfa("admin", "aal2", PROD)).toBe(false);
  });

  it("never applies to a patient or a supporter (both are role patient)", () => {
    expect(staffMustEnrolMfa("patient", "aal1", PROD)).toBe(false);
    expect(staffMustEnrolMfa("patient", undefined, PROD)).toBe(false);
  });

  it("fails closed when the assurance level could not be read", () => {
    expect(staffMustEnrolMfa("clinician", undefined, PROD)).toBe(true);
    expect(staffMustEnrolMfa("admin", null, PROD)).toBe(true);
  });
});

describe("isMfaEnrolmentExemptPath", () => {
  it("allows only the set-up page, the challenge and auth callbacks", () => {
    expect(isMfaEnrolmentExemptPath("/account")).toBe(true);
    expect(isMfaEnrolmentExemptPath("/account/security")).toBe(true);
    expect(isMfaEnrolmentExemptPath("/login/mfa-challenge")).toBe(true);
    expect(isMfaEnrolmentExemptPath("/auth/callback")).toBe(true);
  });

  it("does not exempt a dashboard, an API route or a look-alike path", () => {
    expect(isMfaEnrolmentExemptPath("/clinician")).toBe(false);
    expect(isMfaEnrolmentExemptPath("/admin/settings")).toBe(false);
    expect(isMfaEnrolmentExemptPath("/api/clinician/notes")).toBe(false);
    expect(isMfaEnrolmentExemptPath("/accounting")).toBe(false);
  });
});

describe("local Supabase stack exception", () => {
  it("does not require a factor against a local stack (browser E2E journeys)", () => {
    expect(staffMustEnrolMfa("clinician", "aal1", "http://127.0.0.1:54321")).toBe(false);
    expect(staffMustEnrolMfa("admin", undefined, "http://localhost:54321")).toBe(false);
  });

  it("treats every other URL, an unset one and garbage as production (fail closed)", () => {
    expect(isLocalSupabase("https://koiplnmbgnqnbywhpjlf.supabase.co")).toBe(false);
    expect(isLocalSupabase("https://localhost.evil.example")).toBe(false);
    expect(isLocalSupabase(undefined)).toBe(false);
    expect(isLocalSupabase("not a url")).toBe(false);
    expect(staffMustEnrolMfa("clinician", "aal1", undefined)).toBe(true);
  });
});
