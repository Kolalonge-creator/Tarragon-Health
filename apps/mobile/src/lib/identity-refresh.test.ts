import { eventMayChangeIdentity, nextIdentity, sameIdentity } from "./identity-refresh";
import type { PatientIdentity } from "@/lib/identity";

const base: PatientIdentity = { fullName: "Ada Obi", patientNumber: "P1", organisationId: "o1", initials: "AO", role: "patient", sex: "female", dateOfBirth: "1985-05-05", receivesCare: true, isDependent: false };

describe("identity refresh", () => {
  it("re-reads after the auth events that can follow a server-side change, and not after others", () => {
    for (const e of ["SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"]) expect(eventMayChangeIdentity(e)).toBe(true);
    for (const e of ["INITIAL_SESSION", "SIGNED_OUT", "PASSWORD_RECOVERY"]) expect(eventMayChangeIdentity(e)).toBe(false);
  });

  it("keeps the held object when nothing changed, so effects keyed on it do not restart", () => {
    expect(nextIdentity(base, { ...base })).toBe(base);
  });

  it("takes the new identity when the role or organisation changed", () => {
    const promoted = { ...base, role: "clinician" };
    expect(nextIdentity(base, promoted)).toBe(promoted);
    const moved = { ...base, organisationId: "o2" };
    expect(nextIdentity(base, moved)).toBe(moved);
  });

  it("keeps what is held when the re-read fails or returns nothing", () => {
    expect(nextIdentity(base, null)).toBe(base);
  });

  it("compares every field", () => {
    expect(sameIdentity(base, { ...base, patientNumber: "P2" })).toBe(false);
    expect(sameIdentity(null, null)).toBe(true);
    expect(sameIdentity(base, null)).toBe(false);
  });
});

describe("identity refresh and demographics", () => {
  it("treats a newly saved sex or date of birth as a change, so the gate lifts", () => {
    const missing = { ...base, sex: null, dateOfBirth: null };
    expect(sameIdentity(missing, base)).toBe(false);
    expect(nextIdentity(missing, base)).toBe(base);
  });
});
