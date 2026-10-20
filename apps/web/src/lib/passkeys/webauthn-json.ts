/**
 * Browser-side WebAuthn glue. The server (Supabase Auth) speaks the W3C JSON form: binary fields are base64url strings. The
 * browser API wants ArrayBuffers going in and gives ArrayBuffers coming out. These helpers convert both ways. Pure functions, no
 * network, no cookies: they never see a session, only the options Auth issued and the credential the authenticator signed.
 */

export type Base64Url = string;

export function base64UrlToBytes(value: Base64Url): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): Base64Url {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i += 1) bin += String.fromCharCode(view[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type DescriptorJSON = { id: Base64Url; type: "public-key"; transports?: string[] };

export type CreationOptionsJSON = {
  rp: { id?: string; name: string };
  user: { id: Base64Url; name: string; displayName: string };
  challenge: Base64Url;
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: DescriptorJSON[];
  authenticatorSelection?: Record<string, unknown>;
  attestation?: string;
  extensions?: Record<string, unknown>;
};

export type RequestOptionsJSON = {
  challenge: Base64Url;
  timeout?: number;
  rpId?: string;
  allowCredentials?: DescriptorJSON[];
  userVerification?: string;
  extensions?: Record<string, unknown>;
};

/** Register: JSON options in, native options out. Exported separately so it can be tested without a browser. */
export function creationOptionsFromJSON(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...(json as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64UrlToBytes(json.challenge) as BufferSource,
    user: { ...json.user, id: base64UrlToBytes(json.user.id) as BufferSource },
    excludeCredentials: json.excludeCredentials?.map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: base64UrlToBytes(c.id) as BufferSource,
    })),
  };
}

export function requestOptionsFromJSON(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...(json as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64UrlToBytes(json.challenge) as BufferSource,
    allowCredentials: json.allowCredentials?.map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: base64UrlToBytes(c.id) as BufferSource,
    })),
  };
}

export type RegistrationCredentialJSON = {
  id: Base64Url;
  rawId: Base64Url;
  type: "public-key";
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: Base64Url;
    attestationObject: Base64Url;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: Base64Url;
    authenticatorData?: Base64Url;
  };
};

export type AuthenticationCredentialJSON = {
  id: Base64Url;
  rawId: Base64Url;
  type: "public-key";
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: Base64Url;
    authenticatorData: Base64Url;
    signature: Base64Url;
    userHandle?: Base64Url;
  };
};

export function registrationCredentialToJSON(cred: PublicKeyCredential): RegistrationCredentialJSON {
  const r = cred.response as AuthenticatorAttestationResponse;
  const transports = typeof r.getTransports === "function" ? r.getTransports() : undefined;
  const publicKey = typeof r.getPublicKey === "function" ? r.getPublicKey() : null;
  return {
    id: cred.id,
    rawId: bytesToBase64Url(cred.rawId),
    type: "public-key",
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults() as Record<string, unknown>,
    response: {
      clientDataJSON: bytesToBase64Url(r.clientDataJSON),
      attestationObject: bytesToBase64Url(r.attestationObject),
      transports,
      publicKeyAlgorithm: typeof r.getPublicKeyAlgorithm === "function" ? r.getPublicKeyAlgorithm() : undefined,
      publicKey: publicKey ? bytesToBase64Url(publicKey) : undefined,
      authenticatorData: typeof r.getAuthenticatorData === "function" ? bytesToBase64Url(r.getAuthenticatorData()) : undefined,
    },
  };
}

export function authenticationCredentialToJSON(cred: PublicKeyCredential): AuthenticationCredentialJSON {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bytesToBase64Url(cred.rawId),
    type: "public-key",
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults() as Record<string, unknown>,
    response: {
      clientDataJSON: bytesToBase64Url(r.clientDataJSON),
      authenticatorData: bytesToBase64Url(r.authenticatorData),
      signature: bytesToBase64Url(r.signature),
      // an empty handle means "none"; sending '' would fail validation for a perfectly good credential
      userHandle: r.userHandle && r.userHandle.byteLength > 0 ? bytesToBase64Url(r.userHandle) : undefined,
    },
  };
}

/** True only in a browser that can run a WebAuthn ceremony. Safe to call during render on the server (returns false). */
export function webAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

export type CeremonyOutcome<T> = { ok: true; credential: T } | { ok: false; reason: "cancelled" | "unsupported" | "failed" };

/** Map what a browser throws into a reason. A cancelled prompt (NotAllowedError, AbortError) is not an error to the person. */
export function ceremonyFailureReason(e: unknown): "cancelled" | "failed" {
  const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  return name === "NotAllowedError" || name === "AbortError" ? "cancelled" : "failed";
}

export async function runRegistrationCeremony(options: CreationOptionsJSON): Promise<CeremonyOutcome<RegistrationCredentialJSON>> {
  if (!webAuthnSupported()) return { ok: false, reason: "unsupported" };
  try {
    const cred = (await navigator.credentials.create({ publicKey: creationOptionsFromJSON(options) })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, reason: "cancelled" };
    return { ok: true, credential: registrationCredentialToJSON(cred) };
  } catch (e) {
    return { ok: false, reason: ceremonyFailureReason(e) };
  }
}

export async function runAuthenticationCeremony(options: RequestOptionsJSON): Promise<CeremonyOutcome<AuthenticationCredentialJSON>> {
  if (!webAuthnSupported()) return { ok: false, reason: "unsupported" };
  try {
    const cred = (await navigator.credentials.get({ publicKey: requestOptionsFromJSON(options) })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, reason: "cancelled" };
    return { ok: true, credential: authenticationCredentialToJSON(cred) };
  } catch (e) {
    return { ok: false, reason: ceremonyFailureReason(e) };
  }
}

/** Remembered on this device only, so the sign-in page can offer "Use a passkey" without asking the server who has one. */
export const PASSKEY_DEVICE_NOTE = "tarragon.passkey.device-note";

export function rememberPasskeyOnThisDevice(): void {
  try {
    window.localStorage.setItem(PASSKEY_DEVICE_NOTE, "1");
  } catch {
    // Private window or blocked storage: the button simply does not appear. Never an error.
  }
}

export function forgetPasskeyOnThisDevice(): void {
  try {
    window.localStorage.removeItem(PASSKEY_DEVICE_NOTE);
  } catch {
    // ignore
  }
}

export function passkeyHintedOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(PASSKEY_DEVICE_NOTE) === "1";
  } catch {
    return false;
  }
}
