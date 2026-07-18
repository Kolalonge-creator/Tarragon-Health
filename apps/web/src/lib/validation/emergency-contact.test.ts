import { describe, expect, it } from "@jest/globals";
import { emergencyContactSchema } from "./emergency-contact";

describe("emergencyContactSchema", () => {
  it("accepts a full valid contact with consent", () => {
    expect(
      emergencyContactSchema.safeParse({
        emergency_contact_name: "Ada Obi",
        emergency_contact_phone: "+2348012345678",
        emergency_contact_relationship: "Spouse",
        emergency_contact_consent: true,
        next_of_kin_name: "Emeka Obi",
        next_of_kin_phone: "+2348098765432",
      }).success
    ).toBe(true);
  });

  it("rejects a contact phone without consent", () => {
    expect(
      emergencyContactSchema.safeParse({
        emergency_contact_phone: "+2348012345678",
        emergency_contact_consent: false,
      }).success
    ).toBe(false);
  });

  it("allows saving with no phone and no consent (nothing to consent to)", () => {
    expect(
      emergencyContactSchema.safeParse({ emergency_contact_name: "Ada Obi" }).success
    ).toBe(true);
  });

  it("accepts an entirely empty form (all optional)", () => {
    expect(emergencyContactSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an empty-string phone (clearing the field)", () => {
    expect(
      emergencyContactSchema.safeParse({ emergency_contact_phone: "" }).success
    ).toBe(true);
  });

  it("rejects a non-E.164 emergency contact phone", () => {
    expect(
      emergencyContactSchema.safeParse({ emergency_contact_phone: "08012345678" }).success
    ).toBe(false);
  });

  it("rejects a non-E.164 next-of-kin phone", () => {
    expect(
      emergencyContactSchema.safeParse({ next_of_kin_phone: "1234" }).success
    ).toBe(false);
  });
});
