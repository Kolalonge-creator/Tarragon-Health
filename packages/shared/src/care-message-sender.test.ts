import { careMessageSender, careMessageSenderLine } from "./care-message-sender";

describe("careMessageSender", () => {
  it("labels each tier with a plain role", () => {
    expect(careMessageSender({ full_name: "Ada Obi", doctor_tier: "senior_medical_officer" })).toEqual({ name: "Ada Obi", role: "Doctor" });
    expect(careMessageSender({ full_name: "Ada Obi", doctor_tier: "chief_medical_officer" }).role).toBe("Chief Medical Officer");
    expect(careMessageSender({ full_name: "Tolu Ade", doctor_tier: "care_coordinator" }).role).toBe("Care coordinator");
  });
  it("never claims a role without a tier", () => {
    expect(careMessageSender({ full_name: "Ada Obi", doctor_tier: null })).toEqual({ name: "Ada Obi", role: null });
  });
  it("is null-gated when there is no actor or no name", () => {
    expect(careMessageSender(null)).toEqual({ name: null, role: null });
    expect(careMessageSender({ full_name: "  ", doctor_tier: "senior_medical_officer" })).toEqual({ name: null, role: null });
  });
});

describe("careMessageSenderLine", () => {
  it("falls back to Care team", () => {
    expect(careMessageSenderLine(null)).toBe("Care team");
  });
  it("joins name and role", () => {
    expect(careMessageSenderLine({ full_name: "Ada Obi", doctor_tier: "senior_medical_officer" })).toBe("Ada Obi, Doctor");
  });
});
