/**
 * Optional passkeys, server side (docs/design/passkeys.md).
 *
 * What is pinned here is OUR logic around Supabase Auth. Auth itself (not mocked away in production, only faked here) checks the
 * challenge, its five minute expiry, the origin and relying-party id, the signature and the signature counter; each of those
 * failures comes back to us as an Auth error code. So "challenge expired", "counter replay", "wrong origin or RP id" and "removed
 * credential" are tested here as what they are to this code: a failed verification that must read exactly like every other failure
 * (no enumeration), must not create a session, and must not redirect.
 *
 *  - nothing happens while the switch or the database gate is missing;
 *  - adding needs the password re-checked BEFORE the authorisation is recorded and BEFORE Auth is asked for a challenge;
 *  - sign-in has one failure message whatever the cause, is rate limited, never redirects on failure, and ends a session that
 *    belongs to a non-patient account;
 *  - removing always works (switch off included).
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const available = jest.fn();
const switchOn = jest.fn();
const startRegistration = jest.fn();
const verifyRegistration = jest.fn();
const startAuthentication = jest.fn();
const verifyAuthentication = jest.fn();
const updatePasskey = jest.fn();
const deletePasskey = jest.fn();
const signOut = jest.fn();
const profileQuery = jest.fn();
const passkeyClient = {
  auth: {
    passkey: {
      startRegistration: (...a: unknown[]) => startRegistration(...a),
      verifyRegistration: (...a: unknown[]) => verifyRegistration(...a),
      startAuthentication: (...a: unknown[]) => startAuthentication(...a),
      verifyAuthentication: (...a: unknown[]) => verifyAuthentication(...a),
      update: (...a: unknown[]) => updatePasskey(...a),
      delete: (...a: unknown[]) => deletePasskey(...a),
    },
    signOut: (...a: unknown[]) => signOut(...a),
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profileQuery() }) }) }),
};
const getCurrentUser = jest.fn();
jest.mock("./server", () => ({
  createPasskeyClient: () => Promise.resolve(passkeyClient),
  passkeysAvailable: () => available(),
  passkeysSwitchOn: () => switchOn(),
  // the real helper reads the user and the profile; here it reads the same two fakes
  activePatientUser: async () => {
    const user = await getCurrentUser();
    if (!user) return { user: null, error: "sessionExpired" };
    const { data: profile } = await profileQuery();
    if (!profile || profile.role !== "patient" || profile.is_active !== true) return { user: null, error: "notAvailableForAccount" };
    return { user, error: null };
  },
}));
jest.mock("@/lib/supabase/server", () => ({ getCurrentUser: () => getCurrentUser() }));

const sentry = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => sentry(...a) }));

const svcRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => svcRpc(...a) }) }));

const verifyPassword = jest.fn();
jest.mock("@/lib/account/step-up", () => ({ verifyAccountPassword: (...a: unknown[]) => verifyPassword(...a) }));

const rateLimit = jest.fn();
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: (...a: unknown[]) => rateLimit(...a) }));

const redirectAfterLogin = jest.fn();
jest.mock("@/lib/auth/redirect-after-login", () => ({ redirectAfterLogin: (...a: unknown[]) => redirectAfterLogin(...a) }));

import {
  beginPasskeyRegistration,
  beginPasskeySignIn,
  cancelPasskeyAdd,
  finishPasskeyRegistration,
  finishPasskeySignIn,
  removePasskey,
  renamePasskey,
} from "./actions";
import { PASSKEY_MESSAGES } from "./messages";
import { passkeyRules } from "./rules";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.ng", email_confirmed_at: "2026-01-01" };
const PK = "22222222-2222-4222-8222-222222222222";
const OPTIONS = { challenge: "abc", rp: { name: "Tarragon Health" } };

const authCredential = {
  id: "AAAA",
  rawId: "AAAA",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "AAAA", authenticatorData: "AAAA", signature: "AAAA" },
};
const regCredential = {
  id: "AAAA",
  rawId: "AAAA",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "AAAA", attestationObject: "AAAA", transports: ["internal"] },
};

beforeEach(() => {
  jest.clearAllMocks();
  available.mockResolvedValue(true);
  switchOn.mockResolvedValue(true);
  getCurrentUser.mockResolvedValue(USER);
  profileQuery.mockResolvedValue({ data: { role: "patient", is_active: true } });
  verifyPassword.mockResolvedValue({ ok: true });
  svcRpc.mockResolvedValue({ data: true, error: null });
  rateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  startRegistration.mockResolvedValue({ data: { challenge_id: "ch-12345678", options: OPTIONS }, error: null });
  verifyRegistration.mockResolvedValue({ data: { id: PK }, error: null });
  startAuthentication.mockResolvedValue({ data: { challenge_id: "ch-12345678", options: OPTIONS }, error: null });
  verifyAuthentication.mockResolvedValue({ data: { user: { id: USER.id }, session: { access_token: "t" } }, error: null });
  updatePasskey.mockResolvedValue({ data: {}, error: null });
  deletePasskey.mockResolvedValue({ data: null, error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("adding a passkey", () => {
  it("rechecks the password, THEN asks Auth for a challenge, THEN opens the authorisation window with the proposed minutes", async () => {
    const res = await beginPasskeyRegistration("secret-passphrase");
    expect(res).toEqual({ ok: true, challengeId: "ch-12345678", options: OPTIONS });
    expect(verifyPassword).toHaveBeenCalledWith(USER, "secret-passphrase");
    expect(svcRpc).toHaveBeenCalledWith("authorise_passkey_add", { p_user: USER.id, p_minutes: passkeyRules().add_authorisation_minutes });
    expect(verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(startRegistration.mock.invocationCallOrder[0]);
    expect(startRegistration.mock.invocationCallOrder[0]).toBeLessThan(svcRpc.mock.invocationCallOrder[0]);
  });

  it("a wrong password records no authorisation and asks Auth for nothing", async () => {
    verifyPassword.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const res = await beginPasskeyRegistration("nope");
    expect(res).toEqual({ ok: false, error: PASSKEY_MESSAGES.wrongPassword });
    expect(svcRpc).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("an account with no password route is told how to fix it; a rate limited check says wait", async () => {
    verifyPassword.mockResolvedValue({ ok: false, reason: "no_password_route" });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.noPasswordRoute });
    verifyPassword.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.rateLimited });
  });

  it("does nothing at all while the switch or the database gate is missing", async () => {
    available.mockResolvedValue(false);
    expect(await beginPasskeyRegistration("secret-passphrase")).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInUnavailable });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(svcRpc).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("is for active patients only, refused before the password is even checked", async () => {
    profileQuery.mockResolvedValue({ data: { role: "clinician", is_active: true } });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.notAvailableForAccount });
    profileQuery.mockResolvedValue({ data: { role: "patient", is_active: false } });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.notAvailableForAccount });
    getCurrentUser.mockResolvedValue(null);
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.sessionExpired });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("hands back no challenge if the authorisation could not be recorded", async () => {
    svcRpc.mockResolvedValue({ data: false, error: null });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    svcRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await beginPasskeyRegistration("x")).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
  });

  it("opens no authorisation window when Auth will not issue a challenge", async () => {
    startRegistration.mockResolvedValue({ data: null, error: { code: "unexpected_failure", message: "x" } });
    expect(await beginPasskeyRegistration("secret-passphrase")).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("an error reading the freshness is an error, not 'your window closed'", async () => {
    svcRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    expect(sentry).toHaveBeenCalled();
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it("a failed cancel is reported, not swallowed", async () => {
    svcRpc.mockResolvedValue({ data: null, error: { message: "grant" } });
    await cancelPasskeyAdd();
    expect(sentry).toHaveBeenCalled();
  });

  it("finishing stores the passkey through Auth and names it", async () => {
    const res = await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "  My   phone " });
    expect(res).toEqual({ ok: true, named: true });
    expect(verifyRegistration).toHaveBeenCalledWith({ challengeId: "ch-12345678", credential: regCredential });
    expect(updatePasskey).toHaveBeenCalledWith({ passkeyId: PK, friendlyName: "My phone" });
  });

  it("a naming failure does not turn a stored passkey into a failed add, and is reported, not hidden", async () => {
    updatePasskey.mockRejectedValue(new Error("network"));
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "Laptop" })).toEqual({ ok: true, named: false });
    // the real client RESOLVES with { error } rather than throwing
    updatePasskey.mockResolvedValue({ data: null, error: { code: "x", message: "y" } });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "Laptop" })).toEqual({ ok: true, named: false });
  });

  it("asks the person for the password again, before Auth spends the challenge, when the window has closed", async () => {
    svcRpc.mockResolvedValue({ data: false, error: null });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.recheckPassword });
    expect(svcRpc).toHaveBeenCalledWith("has_fresh_passkey_add_authorisation", { p_user: USER.id });
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it("closes the authorisation window early when Auth refuses to verify, and when the prompt is cancelled", async () => {
    verifyRegistration.mockResolvedValue({ data: null, error: { code: "webauthn_verification_failed", message: "x" } });
    await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" });
    expect(svcRpc).toHaveBeenCalledWith("cancel_passkey_add", { p_user: USER.id });
    svcRpc.mockClear();
    await cancelPasskeyAdd();
    expect(svcRpc).toHaveBeenCalledWith("cancel_passkey_add", { p_user: USER.id });
  });

  it("refuses an oversized or non-text password before it reaches the password check", async () => {
    expect(await beginPasskeyRegistration("x".repeat(257))).toEqual({ ok: false, error: PASSKEY_MESSAGES.wrongPassword });
    expect(await beginPasskeyRegistration(undefined as unknown as string)).toEqual({ ok: false, error: PASSKEY_MESSAGES.wrongPassword });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("maps Auth's registration errors to plain words, and anything unknown to the generic one", async () => {
    verifyRegistration.mockResolvedValue({ data: null, error: { code: "webauthn_credential_exists", message: "x" } });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.alreadyRegistered });
    verifyRegistration.mockResolvedValue({ data: null, error: { code: "too_many_passkeys", message: "x" } });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.tooMany });
    // challenge expired, wrong origin / RP id, bad signature: all "verification failed" to us, none leaks detail
    for (const code of ["webauthn_challenge_expired", "webauthn_challenge_not_found", "webauthn_verification_failed", "unexpected_failure"]) {
      verifyRegistration.mockResolvedValue({ data: null, error: { code, message: "internal detail" } });
      const res = await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" });
      expect(res).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    }
    // the database gate's refusal, when Auth passes its text through
    verifyRegistration.mockResolvedValue({ data: null, error: { code: "unexpected_failure", message: "passkey_step_up_required" } });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.noPasswordRoute });
  });

  it("rejects a bad name or a malformed credential before Auth is called", async () => {
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: "   " })).toEqual({ ok: false, error: PASSKEY_MESSAGES.badName });
    const tooLong = "x".repeat(passkeyRules().label_max_chars + 1);
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: regCredential, label: tooLong })).toEqual({ ok: false, error: PASSKEY_MESSAGES.badName });
    expect(await finishPasskeyRegistration({ challengeId: "ch-12345678", credential: { id: "x" }, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    expect(await finishPasskeyRegistration({ challengeId: "", credential: regCredential, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
    expect(verifyRegistration).not.toHaveBeenCalled();
  });
});

describe("signing in with a passkey", () => {
  it("is rate limited per source and asks Auth for nothing when limited", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 60 });
    expect(await beginPasskeySignIn()).toEqual({ ok: false, error: PASSKEY_MESSAGES.rateLimited });
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.rateLimited });
    expect(verifyAuthentication).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith("passkey-start", null, { limit: passkeyRules().start_per_ip_per_5min, windowSeconds: 300 });
    expect(rateLimit).toHaveBeenCalledWith("passkey-verify", null, { limit: passkeyRules().verify_per_ip_per_5min, windowSeconds: 300 });
  });

  it("starting needs no account name and returns only the challenge and options", async () => {
    expect(await beginPasskeySignIn()).toEqual({ ok: true, challengeId: "ch-12345678", options: OPTIONS });
    expect(startAuthentication).toHaveBeenCalledWith();
  });

  it("every failure reads the same: expired challenge, replayed counter, wrong origin, removed credential, banned, unconfirmed", async () => {
    const codes = [
      "webauthn_challenge_expired",
      "webauthn_challenge_not_found",
      "webauthn_credential_not_found", // a removed credential
      "webauthn_verification_failed", // wrong origin / RP id / bad signature / counter went backwards
      "user_banned",
      "email_not_confirmed",
      "phone_not_confirmed",
      "unexpected_failure",
    ];
    for (const code of codes) {
      verifyAuthentication.mockResolvedValue({ data: null, error: { code, message: `detail for ${code}` } });
      const res = await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential, redirectTo: "/patient" });
      expect(res).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    }
    expect(redirectAfterLogin).not.toHaveBeenCalled();
  });

  it("a malformed credential or challenge fails the same way without calling Auth", async () => {
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: { id: "x" } })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    expect(await finishPasskeySignIn({ challengeId: "x", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: { ...authCredential, response: { ...authCredential.response, signature: "not base64url!" } } })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    expect(verifyAuthentication).not.toHaveBeenCalled();
  });

  it("a session for a non-patient account is ended and reads like any other failure", async () => {
    profileQuery.mockResolvedValue({ data: { role: "clinician", is_active: true } });
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(redirectAfterLogin).not.toHaveBeenCalled();
    profileQuery.mockResolvedValue({ data: null });
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
    profileQuery.mockResolvedValue({ data: { role: "patient", is_active: false } });
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInFailed });
  });

  it("success lands through the shared post-login path with the sanitiser's input, and nowhere else", async () => {
    await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential, redirectTo: "/patient/vitals" });
    expect(redirectAfterLogin).toHaveBeenCalledWith(passkeyClient, USER.id, "/patient/vitals");
    redirectAfterLogin.mockClear();
    await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential });
    expect(redirectAfterLogin).toHaveBeenCalledWith(passkeyClient, USER.id, null);
  });

  it("does nothing while the switch or the database gate is missing", async () => {
    available.mockResolvedValue(false);
    expect(await beginPasskeySignIn()).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInUnavailable });
    expect(await finishPasskeySignIn({ challengeId: "ch-12345678", credential: authCredential })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInUnavailable });
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(verifyAuthentication).not.toHaveBeenCalled();
  });
});

describe("renaming and removing", () => {
  it("removing works even with the switch off, needs a valid id and a patient session", async () => {
    available.mockResolvedValue(false);
    switchOn.mockResolvedValue(false);
    expect(await removePasskey({ id: PK })).toEqual({ ok: true });
    expect(deletePasskey).toHaveBeenCalledWith({ passkeyId: PK });
    expect(await removePasskey({ id: "not-a-uuid" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.notFound });
    getCurrentUser.mockResolvedValue(null);
    expect(await removePasskey({ id: PK })).toEqual({ ok: false, error: PASSKEY_MESSAGES.sessionExpired });
  });

  it("a passkey already gone reads as gone, not as a failure", async () => {
    deletePasskey.mockResolvedValue({ data: null, error: { code: "x", message: "y", status: 404 } });
    expect(await removePasskey({ id: PK })).toEqual({ ok: false, error: PASSKEY_MESSAGES.notFound });
  });

  it("a failed removal says nothing was changed", async () => {
    deletePasskey.mockResolvedValue({ data: null, error: { code: "x", message: "y" } });
    expect(await removePasskey({ id: PK })).toEqual({ ok: false, error: PASSKEY_MESSAGES.generic });
  });

  it("renaming checks the name and the id, and is closed while the switch is off", async () => {
    expect(await renamePasskey({ id: PK, label: "Work laptop" })).toEqual({ ok: true });
    expect(updatePasskey).toHaveBeenCalledWith({ passkeyId: PK, friendlyName: "Work laptop" });
    expect(await renamePasskey({ id: PK, label: "" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.badName });
    expect(await renamePasskey({ id: "nope", label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.notFound });
    switchOn.mockResolvedValue(false);
    expect(await renamePasskey({ id: PK, label: "A" })).toEqual({ ok: false, error: PASSKEY_MESSAGES.signInUnavailable });
  });
});
