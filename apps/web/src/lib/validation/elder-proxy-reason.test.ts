import { addElderProxyDependentSchema } from "./elder-proxy-dependent";

const base = {
  full_name: "Ada Okoro",
  phone: "+2348012345678",
  relationship: "mother",
  date_of_birth: "1950-01-01",
  confirmed_consent: true as const,
};

describe("add an adult who cannot confirm for themselves (S42, OQ-47)", () => {
  it("needs a recorded reason why they cannot confirm on their own phone", () => {
    expect(addElderProxyDependentSchema.safeParse(base).success).toBe(false);
    expect(addElderProxyDependentSchema.safeParse({ ...base, reason: "because" }).success).toBe(false);
  });
  it("accepts either recorded reason", () => {
    expect(addElderProxyDependentSchema.safeParse({ ...base, reason: "cannot_receive_code" }).success).toBe(true);
    expect(addElderProxyDependentSchema.safeParse({ ...base, reason: "cannot_set_up_themselves" }).success).toBe(true);
  });
});
