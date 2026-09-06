import { describe, expect, it } from "@jest/globals";
import { authErrorMessage, type AuthErrorContext } from "./auth-error-message";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/password";

const CONTEXTS: AuthErrorContext[] = [
  "sign_in",
  "sign_up",
  "otp_send",
  "otp_verify",
  "password_update",
  "mfa_setup",
  "sign_out_others",
  "generic",
];

/** The literal strings GoTrue and PostgREST were putting in front of users. */
const REAL_PROVIDER_STRINGS = [
  "Invalid login credentials",
  "Email not confirmed",
  "User already registered",
  "Password should be at least 6 characters",
  "Token has expired or is invalid",
  "For security purposes, you can only request this after 47 seconds",
  "AuthApiError: Invalid Refresh Token: Refresh Token Not Found",
  'permission denied for table "profiles"',
  'duplicate key value violates unique constraint "patient_consents_pkey"',
  "JWSError JWSInvalidSignature",
  "TypeError: fetch failed",
  "new row violates row-level security policy for table \"identity_verifications\"",
];

describe("authErrorMessage", () => {
  it("never passes a provider string through unchanged", () => {
    for (const raw of REAL_PROVIDER_STRINGS) {
      for (const context of CONTEXTS) {
        expect(authErrorMessage({ message: raw }, context)).not.toBe(raw);
      }
    }
  });

  it("never leaks a provider internal into the message it does show", () => {
    const forbidden = [
      /AuthApiError/i,
      /PGRST/i,
      /row-level security/i,
      /unique constraint/i,
      /permission denied/i,
      /\btable\b/i,
      /JWS/i,
      /TypeError/,
      /\bJWT\b/,
    ];
    for (const raw of REAL_PROVIDER_STRINGS) {
      for (const context of CONTEXTS) {
        const message = authErrorMessage({ message: raw }, context);
        for (const pattern of forbidden) {
          expect(message).not.toMatch(pattern);
        }
      }
    }
  });

  it("never repeats the provider's own 6-character password minimum", () => {
    // This was the sharpest instance of the leak: GoTrue's default minimum
    // contradicting this platform's rule on the very screen enforcing it.
    const message = authErrorMessage(
      { message: "Password should be at least 6 characters" },
      "sign_up"
    );
    expect(message).not.toContain("6 characters");
    expect(message).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("does not confirm whether an account exists", () => {
    const signIn = authErrorMessage({ message: "Invalid login credentials" }, "sign_in");
    expect(signIn).not.toMatch(/no (such )?account|not registered|unknown (email|user)/i);

    const signUp = authErrorMessage({ message: "User already registered" }, "sign_up");
    expect(signUp).not.toMatch(/already (registered|exists|have an account here)/i);
  });

  it("tells the user what to do about an expired code", () => {
    expect(
      authErrorMessage({ message: "Token has expired or is invalid" }, "otp_verify")
    ).toMatch(/ask for a new one/i);
  });

  it("maps a provider rate-limit to plain waiting advice", () => {
    expect(
      authErrorMessage(
        { message: "For security purposes, you can only request this after 47 seconds" },
        "otp_send"
      )
    ).toMatch(/wait a minute/i);
  });

  it("falls back per context rather than to one anonymous message", () => {
    const unknown = { message: "something nobody has ever seen before" };
    const messages = CONTEXTS.map((context) => authErrorMessage(unknown, context));
    expect(new Set(messages).size).toBe(CONTEXTS.length);
  });

  it("handles a missing, empty or oddly shaped error", () => {
    expect(authErrorMessage(undefined, "sign_in")).toBeTruthy();
    expect(authErrorMessage(null, "sign_in")).toBeTruthy();
    expect(authErrorMessage({}, "sign_in")).toBeTruthy();
    expect(authErrorMessage({ message: 42 }, "sign_in")).toBeTruthy();
    expect(authErrorMessage("Invalid login credentials", "sign_in")).toMatch(/do not match/i);
  });

  it("only applies the signup-specific mapping in the signup context", () => {
    const raw = { message: "User already registered" };
    expect(authErrorMessage(raw, "sign_up")).not.toBe(authErrorMessage(raw, "sign_in"));
  });

  it("writes no em dashes, per the standing copy rule", () => {
    for (const raw of [...REAL_PROVIDER_STRINGS, "", "unknown"]) {
      for (const context of CONTEXTS) {
        expect(authErrorMessage({ message: raw }, context)).not.toContain("—");
      }
    }
  });

  it("ends every message as a sentence", () => {
    for (const raw of [...REAL_PROVIDER_STRINGS, "unknown"]) {
      for (const context of CONTEXTS) {
        expect(authErrorMessage({ message: raw }, context)).toMatch(/[.!?]$/);
      }
    }
  });
});
