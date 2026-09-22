import { describe, expect, it } from "@jest/globals";
import { provisionMemberSchema } from "./members";

const VALID = {
  email: "staff@example.com",
  fullName: "Staff Person",
  phone: "",
  role: "finance" as const,
  organisationId: "",
  password: "longenough1",
};

describe("provisionMemberSchema — password complexity (2026-09-18)", () => {
  // Regression: this used to be a bare min(8), weaker than every
  // patient-facing password field, letting an admin provision a staff
  // account with a digits-only or letters-only password.
  it("accepts a password with a letter and a number", () => {
    expect(provisionMemberSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a letters-only password", () => {
    expect(
      provisionMemberSchema.safeParse({ ...VALID, password: "onlyletters" }).success
    ).toBe(false);
  });

  it("rejects a digits-only password", () => {
    expect(provisionMemberSchema.safeParse({ ...VALID, password: "12345678" }).success).toBe(
      false
    );
  });
});
