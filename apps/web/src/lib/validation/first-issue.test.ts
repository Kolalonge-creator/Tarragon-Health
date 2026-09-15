import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import { firstIssue } from "./first-issue";
import { newPasswordSchema, signupSchema } from "./auth";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_HINT } from "./password";

describe("firstIssue", () => {
  it("returns the failing field's name so the form can mark it invalid", () => {
    const parsed = signupSchema.safeParse({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "not-an-email",
      countryCode: "+234",
      phone: "8012345678",
      password: "longenough",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstIssue(parsed.error, "fallback").field).toBe("email");
  });

  it("carries the schema's own message rather than the fallback", () => {
    const parsed = newPasswordSchema.safeParse({ password: "abc", confirmPassword: "abc" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const result = firstIssue(parsed.error, "fallback");
    expect(result.error).toContain(String(PASSWORD_MIN_LENGTH));
    expect(result.field).toBe("password");
  });

  it("reports the refinement's own path, not the first object key", () => {
    // A mismatched confirmation is attached to confirmPassword by the
    // schema's `.refine(..., { path: ["confirmPassword"] })`, which is the
    // field a user has to fix.
    const parsed = newPasswordSchema.safeParse({
      password: "longenough",
      confirmPassword: "longenoughtoo",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstIssue(parsed.error, "fallback").field).toBe("confirmPassword");
  });

  it("falls back when the error has no usable path", () => {
    const parsed = z.string().safeParse(1);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstIssue(parsed.error, "fallback").field).toBeUndefined();
  });
});

describe("password rule", () => {
  it("shows the same minimum the schemas enforce", () => {
    // The hint is rendered under every password field before submit. If the
    // schema minimum ever moves, this is what stops the visible rule from
    // silently staying behind.
    expect(PASSWORD_RULE_HINT).toContain(String(PASSWORD_MIN_LENGTH));
    const tooShort = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    const longEnough = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(
      newPasswordSchema.safeParse({ password: tooShort, confirmPassword: tooShort }).success
    ).toBe(false);
    expect(
      newPasswordSchema.safeParse({ password: longEnough, confirmPassword: longEnough }).success
    ).toBe(true);
  });
});
