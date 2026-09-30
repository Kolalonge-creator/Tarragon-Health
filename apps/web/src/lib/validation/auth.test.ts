import { describe, expect, it } from "@jest/globals";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  phonePasswordLoginSchema,
  phoneSignupSchema,
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
  it("accepts a valid Nigerian number", () => {
    expect(
      phoneOtpRequestSchema.safeParse({ countryCode: "+234", phone: "8012345678" })
        .success
    ).toBe(true);
  });

  it("accepts a valid diaspora number", () => {
    expect(
      phoneOtpRequestSchema.safeParse({ countryCode: "+44", phone: "7911123456" })
        .success
    ).toBe(true);
  });

  it("rejects a missing country code", () => {
    expect(
      phoneOtpRequestSchema.safeParse({ countryCode: "", phone: "8012345678" }).success
    ).toBe(false);
  });

  it("rejects a subscriber number that is too short", () => {
    expect(
      phoneOtpRequestSchema.safeParse({ countryCode: "+234", phone: "123" }).success
    ).toBe(false);
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
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    countryCode: "+234",
    phone: "8012345678",
    password: "longenough",
  };

  it("accepts a fully valid signup payload", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("combines first/last name and country code/phone on success", () => {
    const result = signupSchema.safeParse(valid);
    expect(result.success && result.data.fullName).toBe("Ada Lovelace");
    expect(result.success && result.data.phone).toBe("+2348012345678");
  });

  it("accepts a diaspora signup payload", () => {
    expect(
      signupSchema.safeParse({ ...valid, countryCode: "+44", phone: "7911123456" })
        .success
    ).toBe(true);
  });

  it("rejects a blank first name", () => {
    expect(signupSchema.safeParse({ ...valid, firstName: " " }).success).toBe(false);
  });

  it("rejects a blank last name", () => {
    expect(signupSchema.safeParse({ ...valid, lastName: " " }).success).toBe(false);
  });
});

describe("S03 Nigerian phone entry", () => {
  const NG = "+2348031234567";

  it.each(["0803 123 4567", "803-123-4567", "8031234567", "08031234567", "2348031234567", "+2340803 123 4567"])(
    "phoneOtpRequestSchema turns %s into the one E.164 number",
    (phone) => {
      const parsed = phoneOtpRequestSchema.safeParse({ countryCode: "+234", phone });
      expect(parsed.success && parsed.data.phone).toBe(NG);
    },
  );

  it("rejects a Nigerian number that cannot be a mobile, so a code is never sent to a dead end", () => {
    for (const phone of ["0603123456", "080312345", "0000000000"]) {
      expect(phoneOtpRequestSchema.safeParse({ countryCode: "+234", phone }).success).toBe(false);
    }
  });

  it("phoneSignupSchema needs no email, normalises the phone and builds the full name", () => {
    const parsed = phoneSignupSchema.safeParse({
      firstName: "Ada",
      lastName: "Obi",
      countryCode: "+234",
      phone: "0803 123 4567",
      password: "a-long-enough-password",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe(NG);
      expect(parsed.data.fullName).toBe("Ada Obi");
      expect("email" in parsed.data).toBe(false);
    }
  });

  it("phoneSignupSchema enforces the 8-character password floor", () => {
    const parsed = phoneSignupSchema.safeParse({
      firstName: "Ada",
      lastName: "Obi",
      countryCode: "+234",
      phone: "8031234567",
      password: "short",
    });
    expect(parsed.success).toBe(false);
  });

  it("phonePasswordLoginSchema normalises the phone and does not length-check the password", () => {
    const parsed = phonePasswordLoginSchema.safeParse({ countryCode: "+234", phone: "0803 123 4567", password: "abc" });
    expect(parsed.success && parsed.data).toEqual({ phone: NG, password: "abc" });
    expect(phonePasswordLoginSchema.safeParse({ countryCode: "+234", phone: "0803 123 4567", password: "" }).success).toBe(false);
  });
});
