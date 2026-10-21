import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";

/**
 * SMART Health Links for a shared record (https://docs.smarthealthit.org/smart-health-links/spec/).
 *
 * A SMART Health Link is a `shlink:/` string a hospital system can read. It holds a manifest URL and a 256-bit key. The system POSTs
 * the manifest URL (with the PIN as the `passcode` when the link has one), gets back a manifest, and decrypts the file inside with the key.
 *
 * How this fits the existing share door:
 *   - The manifest endpoint calls the SAME `record_share_by_token` as the web link. PIN checks, the wrong-PIN lockout, the view cap, the
 *     date window, expiry, revoke and the access log therefore apply to a hospital system exactly as they do to a person. There is no second door.
 *   - The key is HMAC(server secret, token). It is not stored anywhere, and it is not guessable from the manifest URL alone, so a leaked
 *     URL or a log line without the full link cannot be used to read a captured response. Without the server secret
 *     (`SHARE_LINK_KEY_SECRET`) no link can be made and the feature reports itself unavailable. It never falls back to an unkeyed form.
 *   - The file is a FHIR R4 `collection` bundle (see share-fhir.ts), compressed (zip: DEF) and encrypted as a compact JWE
 *     (alg: dir, enc: A256GCM), embedded in the manifest.
 */

export const SHL_CONTENT_TYPE = "application/fhir+json";
export const SHL_LABEL_MAX = 80;
const KEY_BYTES = 32;

const b64url = (buf: Buffer): string => buf.toString("base64url");

export interface ShlPayload {
  url: string;
  key: string;
  flag?: string;
  exp?: number;
  label?: string;
  v: 1;
}

/** HMAC-SHA256(secret, token) as 32 bytes. `null` when no usable secret is configured, so the caller can say "not available". */
export function deriveShlKey(token: string, secret: string | undefined = process.env.SHARE_LINK_KEY_SECRET): Buffer | null {
  if (!secret || secret.length < 32) return null;
  if (token.length < 32) return null;
  return createHmac("sha256", secret).update("tarragon-shl-v1:").update(token).digest();
}

export interface BuildLinkInput {
  token: string;
  /** The public origin of this app, no trailing slash. */
  origin: string;
  expiresAt: string | null;
  pinProtected: boolean;
  recipientLabel?: string | null;
  secret?: string | undefined;
}

/** The `shlink:/...` string for a share, or `null` when no key can be made. */
export function buildShlink(input: BuildLinkInput): string | null {
  const key = deriveShlKey(input.token, input.secret);
  if (!key) return null;
  const exp = input.expiresAt ? Math.floor(new Date(input.expiresAt).getTime() / 1000) : undefined;
  const label = `Tarragon Health record${input.recipientLabel ? ` for ${input.recipientLabel}` : ""}`.slice(0, SHL_LABEL_MAX);
  const payload: ShlPayload = {
    url: `${input.origin.replace(/\/$/, "")}/api/shl/${input.token}`,
    key: b64url(key),
    ...(input.pinProtected ? { flag: "P" } : {}),
    ...(exp !== undefined && Number.isFinite(exp) ? { exp } : {}),
    label,
    v: 1,
  };
  return `shlink:/${b64url(Buffer.from(JSON.stringify(payload), "utf8"))}`;
}

/** Reads a `shlink:/...` string back (used by tests, and handy for support). Returns null for anything malformed. */
export function parseShlink(link: string): ShlPayload | null {
  const body = link.startsWith("shlink:/") ? link.slice("shlink:/".length) : link.split("#shlink:/")[1];
  if (!body) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ShlPayload>;
    if (typeof parsed.url !== "string" || typeof parsed.key !== "string" || parsed.v !== 1) return null;
    return parsed as ShlPayload;
  } catch {
    return null;
  }
}

/** Compact JWE: header . (empty key) . iv . ciphertext . tag. The protected header is the AAD, as RFC 7516 requires. */
export function encryptJwe(plaintext: string, key: Buffer, contentType: string = SHL_CONTENT_TYPE): string {
  if (key.length !== KEY_BYTES) throw new Error("shl_key_length");
  const header = b64url(Buffer.from(JSON.stringify({ alg: "dir", enc: "A256GCM", zip: "DEF", cty: contentType }), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(header, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(plaintext, "utf8"))), cipher.final()]);
  return [header, "", b64url(iv), b64url(ciphertext), b64url(cipher.getAuthTag())].join(".");
}

export interface ManifestFile {
  contentType: string;
  embedded: string;
}

export interface Manifest {
  files: ManifestFile[];
}

export class ShlTooLarge extends Error {
  constructor() {
    super("shl_embedded_too_large");
  }
}

/** The manifest for one bundle. Throws ShlTooLarge when the recipient said it cannot take a file this big inline. */
export function buildManifest(bundleJson: string, key: Buffer, embeddedLengthMax?: number): Manifest {
  const embedded = encryptJwe(bundleJson, key);
  if (embeddedLengthMax !== undefined && embedded.length > embeddedLengthMax) throw new ShlTooLarge();
  return { files: [{ contentType: SHL_CONTENT_TYPE, embedded }] };
}
