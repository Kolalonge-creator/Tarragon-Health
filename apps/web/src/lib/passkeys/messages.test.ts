import { ALWAYS_WORKS, PASSKEY_MESSAGES, registrationErrorKey } from "./messages";

describe("passkey wording", () => {
  it("has no em dash or en dash anywhere in what a person reads", () => {
    for (const text of Object.values(PASSKEY_MESSAGES)) expect(text).not.toMatch(/[–—]/);
  });

  it("every message that refuses or fails points back at the ways that always work", () => {
    for (const key of ["signInUnavailable", "generic", "unsupported", "notAvailableForAccount"] as const) {
      expect(PASSKEY_MESSAGES[key]).toContain(ALWAYS_WORKS);
    }
    expect(PASSKEY_MESSAGES.signInFailed).toMatch(/phone number or email/);
  });

  it("the sign-in failure message does not say why, so it cannot reveal whether an account exists", () => {
    expect(PASSKEY_MESSAGES.signInFailed).not.toMatch(/no account|not found|banned|confirm|expired|removed|unknown/i);
  });

  it("maps registration error codes, with a generic fallback", () => {
    expect(registrationErrorKey("webauthn_credential_exists")).toBe("alreadyRegistered");
    expect(registrationErrorKey("too_many_passkeys")).toBe("tooMany");
    expect(registrationErrorKey("passkey_disabled")).toBe("signInUnavailable");
    expect(registrationErrorKey("webauthn_challenge_expired")).toBe("generic");
    expect(registrationErrorKey(undefined)).toBe("generic");
    expect(registrationErrorKey("unexpected_failure", "ERROR: passkey_step_up_required")).toBe("noPasswordRoute");
    expect(registrationErrorKey("unexpected_failure", "ERROR: passkey_not_allowed")).toBe("noPasswordRoute");
  });
});
