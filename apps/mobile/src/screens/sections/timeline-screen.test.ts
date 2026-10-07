import { actorSubtitle } from "./timeline-screen";

describe("timeline actor attribution", () => {
  it("shows a plain 'Dr. First Last' for a clinical-tier actor, no credential number", () => {
    expect(
      actorSubtitle({
        full_name: "Amaka Okafor",
        doctor_tier: "senior_medical_officer",
      } as never)
    ).toBe("By Dr. Amaka Okafor");
  });

  it("never appends a credential number even if the row carries one", () => {
    expect(
      actorSubtitle({
        full_name: "Amaka Okafor",
        doctor_tier: "medical_officer",
        credential_type: "MDCN",
        credential_number: "12345",
      } as never)
    ).toBe("By Dr. Amaka Okafor");
  });

  it("attributes a non-clinical-tier actor (e.g. Care Coordinator) to 'your care team', never 'Dr.'", () => {
    expect(
      actorSubtitle({
        full_name: "Chidinma Eze",
        doctor_tier: "care_coordinator",
      } as never)
    ).toBe("By your care team");
  });

  it("returns undefined when there is no actor", () => {
    expect(actorSubtitle(null)).toBeUndefined();
    expect(actorSubtitle({ full_name: null, doctor_tier: "chief_medical_officer" } as never)).toBeUndefined();
  });
});
