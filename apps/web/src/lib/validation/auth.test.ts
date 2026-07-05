import { describe, expect, it } from "@jest/globals";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  signupSchema,
} from "./auth";

describe("emailLoginSchema", () => {
  it("accepts a valid email + password", () => {
    expect(
      emailLoginSchema.safeParse({ email: "a@b.com", password: "longenough" })
        .success
    ).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(
      emailLoginSchema.safeParse({ email: "not-an-email", password: "longenough" })
        .success
    ).toBe(false);
  });

  it("rejects a short password", () => {
    expect(
      emailLoginSchema.safeParse({ email: "a@b.com", password: "short" }).success
    ).toBe(false);
  });
});

describe("phoneOtpRequestSchema", () => {
  it("accepts a valid Nigerian E.164 number", () => {
    expect(
      phoneOtpRequestSchema.safeParse({ phone: "+2348012345678" }).success
    ).toBe(true);
  });

  it("rejects a non-Nigerian number", () => {
    expect(phoneOtpRequestSchema.safeParse({ phone: "+447911123456" }).success).toBe(
      false
    );
  });

  it("rejects a number missing the country code", () => {
    expect(phoneOtpRequestSchema.safeParse({ phone: "08012345678" }).success).toBe(
      false
    );
  });
});

describe("phoneOtpVerifySchema", () => {
  it("accepts a 6-digit code", () => {
    expect(
      phoneOtpVerifySchema.safeParse({ phone: "+2348012345678", token: "123456" })
        .success
    ).toBe(true);
  });

  it("rejects a short code", () => {
    expect(
      phoneOtpVerifySchema.safeParse({ phone: "+2348012345678", token: "123" })
        .success
    ).toBe(false);
  });
});

describe("signupSchema", () => {
  const valid = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+2348012345678",
    password: "longenough",
  };

  it("accepts a fully valid signup payload", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a blank full name", () => {
    expect(signupSchema.safeParse({ ...valid, fullName: " " }).success).toBe(false);
  });
});
