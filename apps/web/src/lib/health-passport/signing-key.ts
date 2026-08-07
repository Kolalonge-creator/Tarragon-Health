import "server-only";
import { createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { base64UrlEncode, CREDENTIAL_ALGORITHM } from "./credential";

/**
 * The private half. This module is the only place in the codebase that reads it,
 * and `server-only` is what stops an accidental client import from turning that
 * sentence into a lie at build time rather than in production.
 *
 * ## Where the key lives
 *
 * `HEALTH_PASSPORT_SIGNING_KEY` — a PKCS#8 PEM Ed25519 private key, in the
 * server environment, nowhere else. Not in the database (the `passport_signing_keys`
 * table deliberately has no column that could hold it), not in a repo, not in a
 * `NEXT_PUBLIC_` variable. Because newlines are awkward in most secret managers
 * the value may also be supplied base64-encoded; both forms are accepted.
 *
 * `HEALTH_PASSPORT_SIGNING_KID` — the key id written into every credential this
 * key signs, and the id a verifier uses to look the public half back up. Must
 * match a row in `passport_signing_keys`.
 *
 * ## When it is missing
 *
 * `getSigner()` returns null and the platform degrades honestly: the Health
 * Passport still generates, still contains real data, and says on its face that
 * it is unsigned and cannot be verified. It must never invent a signature,
 * display a verification badge it cannot back, or fail closed and deny a patient
 * their own record. An unsigned passport is a weaker document; a fake signature
 * would be a lie, and a broken download would be a worse product than the one
 * this feature replaced.
 *
 * ## Rotation
 *
 * Publish a new kid, register its public half with `register_passport_signing_key`,
 * point the environment at it, then `retire_passport_signing_key` the old one.
 * Old passports keep verifying because the retired public key stays readable
 * forever — retirement stops a key signing new documents, it does not
 * invalidate the ones it already signed.
 */

export interface PassportSigner {
  kid: string;
  algorithm: typeof CREDENTIAL_ALGORITHM;
  /** Base64 SPKI of the public half, derived from the private key at load. */
  publicKeySpkiBase64: string;
  /** Detached signature over the exact canonical bytes, base64url. */
  sign(canonicalPayload: string): string;
}

function readPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) {
    // Secret managers that mangle newlines into the two-character sequence \n.
    return trimmed.replace(/\\n/g, "\n");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded;
  } catch {
    // fall through to the failure below
  }
  throw new Error("HEALTH_PASSPORT_SIGNING_KEY is not a PKCS#8 PEM (raw or base64)");
}

function loadPrivateKey(): KeyObject | null {
  const raw = process.env.HEALTH_PASSPORT_SIGNING_KEY;
  if (!raw || raw.trim().length === 0) return null;
  try {
    const key = createPrivateKey({ key: readPem(raw), format: "pem" });
    if (key.asymmetricKeyType !== "ed25519") {
      // Loud, because a deployment that quietly signed with the wrong curve
      // would produce credentials nobody can verify and nobody would notice
      // until an embassy told a patient their document was fake.
      console.error(
        `[health-passport] signing key is ${key.asymmetricKeyType}, expected ed25519 — refusing to sign`
      );
      return null;
    }
    return key;
  } catch (error) {
    console.error("[health-passport] could not load the signing key:", error);
    return null;
  }
}

// Parsed once per server process. The key does not change under a running
// process, and re-parsing PEM on every download would be pure waste.
let cached: PassportSigner | null | undefined;

export function getSigner(): PassportSigner | null {
  if (cached !== undefined) return cached;

  const kid = process.env.HEALTH_PASSPORT_SIGNING_KID?.trim();
  const privateKey = loadPrivateKey();

  if (!kid || !privateKey) {
    if (privateKey && !kid) {
      console.error("[health-passport] a signing key is configured but HEALTH_PASSPORT_SIGNING_KID is not");
    }
    cached = null;
    return null;
  }

  const publicKeySpkiBase64 = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");

  cached = {
    kid,
    algorithm: CREDENTIAL_ALGORITHM,
    publicKeySpkiBase64,
    sign(canonicalPayload: string): string {
      // Ed25519 signs the message directly; the `null` is the scheme saying it
      // owns its own hashing, not a missing argument.
      return base64UrlEncode(cryptoSign(null, Buffer.from(canonicalPayload, "utf8"), privateKey));
    },
  };
  return cached;
}

/** Test seam — the module caches a parsed key for the process lifetime. */
export function resetSignerCacheForTests(): void {
  cached = undefined;
}
