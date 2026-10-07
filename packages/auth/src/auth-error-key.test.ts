import { describe, expect, it } from "@jest/globals";
import { authErrorKey } from "./auth-error-key";

describe("authErrorKey", () => {
  it.each([
    [{ message: "Phone not confirmed" }, "sign_in", "auth.signin.unverified"],
    [{ message: "For security purposes, you can only request this after 47 seconds" }, "otp_send", "auth.error.rate_limited"],
    [{ message: "Token has expired or is invalid" }, "otp_verify", "auth.error.wrong_code"],
    [{ message: "Invalid login credentials" }, "sign_in", "auth.error.sign_in_failed"],
    [{ message: "Invalid phone number" }, "sign_up", "auth.error.invalid_phone"],
    [{ message: "fetch failed" }, "generic", "auth.error.offline"],
    [{ message: "something the provider invented" }, "generic", "auth.error.generic"],
    [null, "sign_in", "auth.error.sign_in_failed"],
    [undefined, "otp_verify", "auth.error.wrong_code"],
  ] as const)("%j in %s -> %s", (error, context, expected) => {
    expect(authErrorKey(error, context)).toBe(expected);
  });

  it("says the same thing for a wrong password and an unknown account (no enumeration)", () => {
    expect(authErrorKey({ message: "Invalid login credentials" }, "sign_in")).toBe(
      authErrorKey({ message: "User not found" }, "sign_in"),
    );
  });
});
