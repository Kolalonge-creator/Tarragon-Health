import { describe, expect, it } from "@jest/globals";
import { isUnknownUserOtpError } from "./otp-errors";

describe("isUnknownUserOtpError", () => {
  it("recognises GoTrue's 'no such user' answers to a code request", () => {
    expect(isUnknownUserOtpError({ code: "otp_disabled", message: "x" })).toBe(true);
    expect(isUnknownUserOtpError({ message: "Signups not allowed for otp" })).toBe(true);
    expect(isUnknownUserOtpError({ message: "User not found" })).toBe(true);
  });
  it("does not swallow a genuine failure", () => {
    expect(isUnknownUserOtpError({ message: "Error sending sms" })).toBe(false);
    expect(isUnknownUserOtpError({ code: "over_sms_send_rate_limit" })).toBe(false);
    expect(isUnknownUserOtpError(null)).toBe(false);
    expect(isUnknownUserOtpError("Signups not allowed for otp")).toBe(false);
  });
});
