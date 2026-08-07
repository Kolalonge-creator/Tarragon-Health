import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { z } from "zod";

/**
 * The Verifiable Health Credential — what a Health Passport actually *is* once
 * you take the paper away.
 *
 * This module is deliberately pure and key-agnostic: it builds the exact bytes
 * that get signed, and it verifies a signature against a public key. It never
 * touches the private key (see `signing-key.ts`, which is server-only) and never
 * touches the database. That separation is what lets the same code path verify a
 * credential in our own verify route, in a unit test, and — in principle — in
 * somebody else's tooling, since everything here is standard Ed25519 over
 * canonical JSON with no Tarragon-specific cryptography invented anywhere.
 *
 * ## The format
 *
 *     THP1.<base64url(canonical JSON payload)>.<base64url(Ed25519 signature)>
 *
 * Three dot-separated parts, JWS-shaped but deliberately not a JWS: there is no
 * header segment to negotiate, no `alg` a verifier could be talked into
 * downgrading, and no `none`. The algorithm is fixed by the format version. A
 * verifier's only decision is which public key to use, which the `kid` in the
 * payload answers.
 *
 * ## Why canonical JSON rather than signing the PDF bytes
 *
 * Signing the rendered PDF would be simpler and worse. PDF generation is not
 * byte-reproducible (creation timestamps, font subsetting, object ordering), so
 * a signature over the file could only ever be checked against the one archived
 * copy of that file, and the passport would stop being verifiable the moment
 * somebody printed it, scanned it, or re-saved it from a phone. Signing the
 * *claims* means the credential survives its container: the same signature
 * verifies whether it arrives as a PDF, a QR scan, a pasted string, or a line
 * read down a phone.
 */

export const CREDENTIAL_FORMAT = "THP1" as const;
export const CREDENTIAL_ALGORITHM = "Ed25519" as const;

/** Where a verifier is told to go, and what the QR encodes. */
export const VERIFY_ISSUER = "TarragonHealth" as const;
export const VERIFY_ISSUER_DOMAIN = "tarragonhealth.ng" as const;

const attestationSchema = z.object({
  /** Real name of a real reviewing doctor. Never a role, never a placeholder. */
  doctor_name: z.string().min(1),
  /** e.g. "MDCN". Present only alongside a number — see `registration` below. */
  credential_type: z.string().min(1),
  credential_number: z.string().min(1),
  attested_at: z.string().min(1),
  statement: z.string().nullable(),
});

/**
 * The signed claim set.
 *
 * Every field here is either issued by the database (identity, attestation,
 * serial, timestamps) or derived from frozen content (the digest). Nothing a
 * browser could assert reaches this object — see `mint_health_passport`, which
 * returns the identity and attestation rather than accepting them.
 */
export const credentialPayloadSchema = z.object({
  v: z.literal(1),
  typ: z.literal("health-passport"),
  iss: z.literal(VERIFY_ISSUER),
  iss_domain: z.literal(VERIFY_ISSUER_DOMAIN),
  alg: z.literal(CREDENTIAL_ALGORITHM),
  kid: z.string().min(1),
  serial: z.string().min(1),
  issued_at: z.string().min(1),
  expires_at: z.string().min(1),
  sub: z.object({
    name: z.string().min(1),
    /** ISO date, or null for an account with no date of birth recorded. */
    dob: z.string().nullable(),
    patient_ref: z.string().nullable(),
  }),
  /** sha256 hex over the canonical serialisation of the frozen content. */
  content_digest: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * Null means "TarragonHealth issued this export of the record", which is a
   * true and useful claim. Non-null means a named, registered doctor reviewed it
   * and put their number to it. The two are never blurred: there is no partial
   * or implied attestation, and the schema requires the registration number
   * whenever a doctor is named.
   */
  attestation: attestationSchema.nullable(),
});

export type CredentialPayload = z.infer<typeof credentialPayloadSchema>;

/**
 * Deterministic JSON: object keys sorted by code unit, no insignificant
 * whitespace, arrays left in order.
 *
 * This is the load-bearing detail of the whole scheme. Two parties must be able
 * to produce byte-identical input from the same claims, or signatures verify by
 * luck. Modelled on RFC 8785 (JCS) and kept to the subset this payload actually
 * uses — strings, finite numbers, booleans, null, arrays, plain objects — so
 * there is no ambiguity to get wrong rather than a general-purpose
 * canonicaliser that quietly handles cases we never emit.
 *
 * `undefined` is rejected rather than dropped: a key that silently vanishes from
 * the signed bytes is exactly the kind of difference that makes a signature fail
 * in production and pass in a test.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("canonicalize: non-finite number cannot be signed");
    }
    return JSON.stringify(value);
  }
  if (t === "undefined") {
    throw new Error("canonicalize: undefined cannot be signed — use null explicitly");
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${t}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The digest that goes into the credential and gets printed on the document. */
export function contentDigest(snapshot: unknown): string {
  return sha256Hex(canonicalize(snapshot));
}

export function base64UrlEncode(input: Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** `THP1.<payload>.<signature>` — the string that goes in the QR and the PDF. */
export function encodeCompact(canonicalPayload: string, signatureB64Url: string): string {
  return `${CREDENTIAL_FORMAT}.${base64UrlEncode(canonicalPayload)}.${signatureB64Url}`;
}

export interface DecodedCredential {
  canonicalPayload: string;
  payload: CredentialPayload;
  signature: Buffer;
}

/**
 * Split and parse a compact credential without checking the signature.
 *
 * Returns null rather than throwing on anything malformed: this parses input
 * that arrives from a QR scanner, a copy-paste, or a stranger's URL bar, and a
 * thrown error on the verify route reads to a verifier as "the site is broken"
 * when the truthful answer is "that is not a Tarragon credential".
 */
export function decodeCompact(compact: string): DecodedCredential | null {
  const parts = compact.trim().split(".");
  if (parts.length !== 3) return null;
  const [format, payloadPart, signaturePart] = parts;
  if (format !== CREDENTIAL_FORMAT) return null;

  try {
    const canonicalPayload = base64UrlDecode(payloadPart).toString("utf8");
    const parsed = credentialPayloadSchema.safeParse(JSON.parse(canonicalPayload));
    if (!parsed.success) return null;
    return {
      canonicalPayload,
      payload: parsed.data,
      signature: base64UrlDecode(signaturePart),
    };
  } catch {
    return null;
  }
}

/** Build a verifiable key object from the base64 SPKI we publish. */
export function publicKeyFromSpkiBase64(spkiBase64: string): KeyObject | null {
  try {
    return createPublicKey({
      key: Buffer.from(spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

/**
 * Does this signature actually come from the holder of the private key?
 *
 * This is the only question that establishes authenticity, and it is answered
 * here rather than by reading a status column. A row in our database saying
 * `status = 'valid'` proves that a row exists; only this check proves that
 * TarragonHealth issued the document. The verify route runs both and requires
 * both — see the header of the migration for why neither may stand in for the
 * other.
 */
export function verifySignature(
  canonicalPayload: string,
  signature: Uint8Array,
  publicKey: KeyObject
): boolean {
  try {
    // Ed25519 takes no digest algorithm — the `null` is the API's way of saying
    // "the scheme already specifies the hash", not an omission.
    return cryptoVerify(null, Buffer.from(canonicalPayload, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

/** Convenience wrapper: parse, then check, in one call. */
export function verifyCompact(
  compact: string,
  spkiBase64: string
): { ok: true; payload: CredentialPayload } | { ok: false; reason: string } {
  const decoded = decodeCompact(compact);
  if (!decoded) return { ok: false, reason: "not_a_credential" };
  const key = publicKeyFromSpkiBase64(spkiBase64);
  if (!key) return { ok: false, reason: "bad_public_key" };
  if (!verifySignature(decoded.canonicalPayload, decoded.signature, key)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true, payload: decoded.payload };
}

/**
 * A short, groupable rendering of the digest for print and for reading aloud.
 *
 * Only the first 16 hex characters (64 bits) are shown. That is not the security
 * boundary — the signature is — it is a human cross-check, and 64 bits of it is
 * already far beyond what anyone would compare by eye. The full digest is
 * printed in the appendix for anyone who wants it.
 */
export function shortDigest(hex: string): string {
  return (hex.slice(0, 16).match(/.{1,4}/g) ?? []).join(" ").toUpperCase();
}

/** Wrap a long base64 blob so it prints as a readable block rather than a smear. */
export function chunk(value: string, size = 64): string[] {
  return value.match(new RegExp(`.{1,${size}}`, "g")) ?? [];
}
