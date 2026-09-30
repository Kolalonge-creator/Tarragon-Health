import { describe, expect, it } from "@jest/globals";
import { isAlreadyRegisteredError, isRateLimitOtpError, isUnknownUserOtpError } from "./otp-errors";

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

describe("isRateLimitOtpError", () => {
  it("recognises GoTrue's resend-gap and rate-limit answers", () => {
    expect(isRateLimitOtpError({ message: "For security purposes, you can only request this after 47 seconds." })).toBe(true);
    expect(isRateLimitOtpError({ code: "over_sms_send_rate_limit", message: "x" })).toBe(true);
    expect(isRateLimitOtpError({ message: "Error sending sms" })).toBe(false);
    expect(isRateLimitOtpError(null)).toBe(false);
  });
});

describe("isAlreadyRegisteredError", () => {
  it("recognises an existing-account answer and nothing else", () => {
    expect(isAlreadyRegisteredError({ code: "user_already_exists", message: "x" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "Password should be at least 6 characters" })).toBe(false);
  });
});
