"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { verifyAccountPassword, type StepUpResult } from "@/lib/account/step-up";
import { activePatientUser, createPasskeyClient, passkeysAvailable, passkeysSwitchOn } from "./server";
import { passkeyRules } from "./rules";
import { PASSKEY_MESSAGES, registrationErrorKey, type PasskeyMessageKey } from "./messages";
import type { CreationOptionsJSON, RequestOptionsJSON } from "./webauthn-json";

/**
 * Optional passkeys for patient sign-in (docs/design/passkeys.md). Passkeys are an extra: nothing here touches the phone, email,
 * password or recovery routes, and every refusal below points back at them.
 *
 * Where the work happens:
 *  - Supabase Auth stores the public key, issues the challenge, checks the origin and relying-party id, the signature and the
 *    signature counter, and expires a challenge after five minutes. We do not re-implement any of that.
 *  - This file adds what Auth cannot: the platform switch, rate limits, the password re-check before a passkey is added, the
 *    patient-only rule, one enumeration-safe sign-in message, and landing the session through the same path as every other sign-in
 *    (new-device notice included).
 *  - The database adds the part a direct call to Auth could skip: a gate on the credential table, plus an audit row and an in-app
 *    and email notice for every passkey added, removed or used, however it happened.
 */

export type PasskeyFail = { ok: false; error: string };
export type RegistrationStart = { ok: true; challengeId: string; options: CreationOptionsJSON } | PasskeyFail;
export type SignInStart = { ok: true; challengeId: string; options: RequestOptionsJSON } | PasskeyFail;
export type SimpleResult = { ok: true } | PasskeyFail;
/** `named: false` means the passkey WAS added but its name could not be saved. */
export type AddResult = { ok: true; named: boolean } | PasskeyFail;

const fail = (key: PasskeyMessageKey): PasskeyFail => ({ ok: false, error: PASSKEY_MESSAGES[key] });

const b64 = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);
const clientResults = z.record(z.string(), z.unknown());

const registrationCredentialSchema = z.object({
  id: b64(1400),
  rawId: b64(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.string().max(40).optional(),
  clientExtensionResults: clientResults,
  response: z.object({
    clientDataJSON: b64(4096),
    attestationObject: b64(32768),
    transports: z.array(z.string().max(32)).max(8).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: b64(4096).optional(),
    authenticatorData: b64(8192).optional(),
  }),
});

const authenticationCredentialSchema = z.object({
  id: b64(1400),
  rawId: b64(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.string().max(40).optional(),
  clientExtensionResults: clientResults,
  response: z.object({
    clientDataJSON: b64(4096),
    authenticatorData: b64(8192),
    signature: b64(2048),
    userHandle: b64(1400).optional(),
  }),
});

const uuid = z.string().uuid();
const passwordInput = z.string().min(1).max(256);
const labelInput = z.string().max(400);
const challenge = z.string().min(8).max(128);

function cleanLabel(raw: unknown): string | null {
  const parsed = labelInput.safeParse(raw);
  if (!parsed.success) return null;
  const max = passkeyRules().label_max_chars;
  const label = parsed.data.replace(/\s+/g, " ").trim();
  return label.length >= 1 && label.length <= max ? label : null;
}

function stepUpKey(reason: Extract<StepUpResult, { ok: false }>["reason"]): PasskeyMessageKey {
  if (reason === "wrong_password") return "wrongPassword";
  if (reason === "rate_limited") return "rateLimited";
  if (reason === "no_password_route") return "noPasswordRoute";
  return "generic";
}

/** Closes the "password was just re-checked" window early. Best effort: it only shortens a window that expires by itself. */
async function cancelAuthorisation(userId: string): Promise<void> {
  try {
    const { error } = await createServiceRoleClient().rpc("cancel_passkey_add", { p_user: userId });
    if (error) Sentry.captureMessage("passkey authorisation could not be cancelled", "warning");
  } catch {
    Sentry.captureMessage("passkey authorisation could not be cancelled", "warning");
  }
}

/** Called when the person cancels the device prompt, so an unspent authorisation does not wait out its full length. */
export async function cancelPasskeyAdd(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await cancelAuthorisation(user.id);
}

/**
 * Step 1 of adding a passkey: the person types their password again, the server checks it, records a short single-use
 * authorisation (service role), and only then asks Auth for the registration challenge. The database refuses to store a passkey
 * without that authorisation, so a stolen access token cannot plant one by skipping this step.
 */
export async function beginPasskeyRegistration(password: string): Promise<RegistrationStart> {
  if (!(await passkeysAvailable())) return fail("signInUnavailable");
  const who = await activePatientUser();
  if (!who.user) return fail(who.error);

  const pw = passwordInput.safeParse(password);
  if (!pw.success) return fail("wrongPassword");
  const checked = await verifyAccountPassword(who.user, pw.data);
  if (!checked.ok) return fail(stepUpKey(checked.reason));

  // Ask Auth for the challenge FIRST and open the authorisation window only once there is a ceremony to run, so the window covers
  // the device prompt and not the time before it.
  const client = await createPasskeyClient();
  const { data, error } = await client.auth.passkey.startRegistration();
  if (error || !data) return fail(registrationErrorKey(error?.code, error?.message));

  const { data: authorised, error: authError } = await createServiceRoleClient().rpc("authorise_passkey_add", {
    p_user: who.user.id,
    p_minutes: passkeyRules().add_authorisation_minutes,
  });
  if (authError || authorised !== true) return fail("generic");
  return { ok: true, challengeId: data.challenge_id, options: data.options as unknown as CreationOptionsJSON };
}

/** Step 2 of adding a passkey: Auth checks the signed response and stores the public key. Naming it is a separate, harmless call. */
export async function finishPasskeyRegistration(input: {
  challengeId: string;
  credential: unknown;
  label: string;
}): Promise<AddResult> {
  if (!(await passkeysAvailable())) return fail("signInUnavailable");
  const who = await activePatientUser();
  if (!who.user) return fail(who.error);

  const credential = registrationCredentialSchema.safeParse(input.credential);
  const challengeId = challenge.safeParse(input.challengeId);
  const label = cleanLabel(String(input.label ?? ""));
  if (!credential.success || !challengeId.success) return fail("generic");
  if (!label) return fail("badName");

  // The window after the password check is short. If it has closed, say so plainly BEFORE Auth spends the challenge, instead of
  // letting the database gate refuse behind a generic Auth error.
  const { data: fresh, error: freshError } = await createServiceRoleClient().rpc("has_fresh_passkey_add_authorisation", { p_user: who.user.id });
  if (freshError) {
    // An infrastructure error must not read as "your window closed".
    Sentry.captureMessage("passkey authorisation freshness could not be read", "error");
    return fail("generic");
  }
  if (fresh !== true) return fail("recheckPassword");

  const client = await createPasskeyClient();
  const { data, error } = await client.auth.passkey.verifyRegistration({
    challengeId: challengeId.data,
    credential: credential.data as never,
  });
  if (error || !data) {
    await cancelAuthorisation(who.user.id);
    return fail(registrationErrorKey(error?.code, error?.message));
  }

  // The passkey exists now. A failure to name it must not read as a failed add, but it must not be hidden either: the client
  // returns { error } (it does not throw), so the result is read and reported as `named: false`.
  let named = true;
  try {
    const renamed = await client.auth.passkey.update({ passkeyId: data.id, friendlyName: label });
    named = !renamed.error;
  } catch {
    named = false;
  }
  revalidatePath("/patient/profile");
  revalidatePath("/account");
  return { ok: true, named };
}

export async function renamePasskey(input: { id: string; label: string }): Promise<SimpleResult> {
  if (!(await passkeysSwitchOn())) return fail("signInUnavailable");
  const who = await activePatientUser();
  if (!who.user) return fail(who.error);
  const id = uuid.safeParse(input.id);
  const label = cleanLabel(String(input.label ?? ""));
  if (!id.success) return fail("notFound");
  if (!label) return fail("badName");
  const client = await createPasskeyClient();
  const { error } = await client.auth.passkey.update({ passkeyId: id.data, friendlyName: label });
  if (error) return fail("generic");
  revalidatePath("/patient/profile");
  revalidatePath("/account");
  return { ok: true };
}

/**
 * Removing needs only a signed-in session: it can only take a way in AWAY. It stays available when the switch is off, so a person
 * can always clear passkeys they no longer want. The owner is told by the database (notice and audit row) whoever removes it.
 */
export async function removePasskey(input: { id: string }): Promise<SimpleResult> {
  const who = await activePatientUser();
  if (!who.user) return fail(who.error);
  const id = uuid.safeParse(input.id);
  if (!id.success) return fail("notFound");
  const client = await createPasskeyClient();
  const { error } = await client.auth.passkey.delete({ passkeyId: id.data });
  if (error) return fail(error.status === 404 ? "notFound" : "generic");
  revalidatePath("/patient/profile");
  revalidatePath("/account");
  return { ok: true };
}

/** Step 1 of sign-in. Needs no account name, so there is nothing here to learn about who has an account. */
export async function beginPasskeySignIn(): Promise<SignInStart> {
  if (!(await passkeysAvailable())) return fail("signInUnavailable");
  const rules = passkeyRules();
  const limited = await checkAuthRateLimit("passkey-start", null, { limit: rules.start_per_ip_per_5min, windowSeconds: 300 });
  if (!limited.success) return fail("rateLimited");

  const client = await createPasskeyClient();
  const { data, error } = await client.auth.passkey.startAuthentication();
  if (error || !data) return fail("signInUnavailable");
  return { ok: true, challengeId: data.challenge_id, options: data.options as unknown as RequestOptionsJSON };
}

/**
 * Step 2 of sign-in. Every failure, whatever the cause, is the same message. On success the session lands through
 * `redirectAfterLogin`, exactly like a password or code sign-in (device recorded, role home or the sanitised destination). If the
 * account has an authenticator-app factor, proxy.ts still asks for it on the next request, so a passkey never skips that step.
 */
export async function finishPasskeySignIn(input: { challengeId: string; credential: unknown; redirectTo?: string }): Promise<SimpleResult> {
  if (!(await passkeysAvailable())) return fail("signInUnavailable");
  const rules = passkeyRules();
  const limited = await checkAuthRateLimit("passkey-verify", null, { limit: rules.verify_per_ip_per_5min, windowSeconds: 300 });
  if (!limited.success) return fail("rateLimited");

  const credential = authenticationCredentialSchema.safeParse(input.credential);
  const challengeId = challenge.safeParse(input.challengeId);
  if (!credential.success || !challengeId.success) return fail("signInFailed");

  const client = await createPasskeyClient();
  const { data, error } = await client.auth.passkey.verifyAuthentication({
    challengeId: challengeId.data,
    credential: credential.data as never,
  });
  if (error || !data?.user || !data.session) return fail("signInFailed");

  // Defence in depth: passkeys are for patient accounts, and the database already refuses to store one for anyone else. If a
  // session ever comes back for another kind of account, end it here and say the same thing as any other failure.
  const { data: profile } = await client.from("profiles").select("role, is_active").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.role !== "patient" || profile.is_active !== true) {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return fail("signInFailed");
  }

  await redirectAfterLogin(client, data.user.id, typeof input.redirectTo === "string" ? input.redirectTo : null);
  return { ok: true };
}
