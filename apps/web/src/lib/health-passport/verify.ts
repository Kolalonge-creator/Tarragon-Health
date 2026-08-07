import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  credentialPayloadSchema,
  publicKeyFromSpkiBase64,
  verifySignature,
  base64UrlDecode,
  type CredentialPayload,
} from "./credential";

/**
 * Resolving a passport for a stranger.
 *
 * This module is what an embassy clerk, a UK GP receptionist or a Lagos triage
 * nurse actually hits. It runs with a bare anon client and imports nothing from
 * the platform's auth layer — the same boundary the emergency card holds, for
 * the same reason: this path must not be *able* to reach anything the serial
 * does not entitle, not merely decline to.
 *
 * ## Two independent checks, both required
 *
 * The migration's header says it and it is worth repeating where the code lives:
 *
 *   AUTHENTICITY comes from the Ed25519 signature, verified here, in this
 *   process, against the published public key. It answers "did TarragonHealth
 *   issue this?". A row in the database saying `status = 'valid'` does not
 *   answer that — the RPC that writes those rows runs as the patient — so this
 *   surface never treats a status column as proof of origin.
 *
 *   CURRENCY comes from the database: revoked, superseded, expired. A signature
 *   is permanent by design and cannot express "this was true in March". Only a
 *   live check can.
 *
 * A document that passes one and fails the other is reported precisely, never
 * rounded to "valid" or "invalid". Telling a consulate "genuine, but replaced by
 * a newer one on 4 March" is the whole product; telling them "invalid" would be
 * both wrong and, for the patient, quietly catastrophic.
 */

export type PassportVerdict =
  /** Signature checks out and the document is current. */
  | "genuine"
  /** Signature checks out; a newer passport has since been issued. */
  | "superseded"
  /** Signature checks out; deliberately withdrawn. */
  | "revoked"
  /** Signature checks out; past its validity date. */
  | "expired"
  /**
   * A record exists but the signature does not verify against the published key,
   * or the signed claims disagree with the record. Reported as its own outcome
   * rather than folded into "not found": it is a genuinely different situation
   * and the honest answer to a verifier is "do not rely on this document".
   */
  | "unverifiable"
  /** No such reference. Most often a typo; possibly a fabricated document. */
  | "not_found";

export interface PassportAttestationView {
  doctorName: string;
  credentialType: string;
  credentialNumber: string;
  attestedAt: string;
  statement: string | null;
}

export interface PassportVerification {
  verdict: PassportVerdict;
  serial: string | null;
  issuer: string;
  issuerDomain: string;
  issuedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  contentDigest: string | null;
  signingKid: string | null;
  signingAlgorithm: string | null;
  /** True only when the Ed25519 check passed AND the claims match the record. */
  signatureValid: boolean;
  /** Why the signature check failed, when it did. Shown to technical verifiers. */
  signatureDetail: string | null;
  subjectNameMasked: string | null;
  subjectYearOfBirth: number | null;
  /** Released only to a caller who could already state the date of birth. */
  subjectName: string | null;
  subjectPatientRef: string | null;
  identityConfirmed: boolean;
  /** True when a date of birth was submitted and did not match. */
  identityRejected: boolean;
  attestation: PassportAttestationView | null;
}

interface RpcPayload {
  serial: string;
  status: "valid" | "superseded" | "revoked" | "expired";
  issuer: string;
  issuer_domain: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  content_digest: string | null;
  signature: string | null;
  signed_payload: string | null;
  signing_kid: string | null;
  signing_public_key: string | null;
  signing_algorithm: string | null;
  subject_name_masked: string | null;
  subject_year_of_birth: number | null;
  identity_confirmed: boolean;
  subject_name: string | null;
  subject_patient_number: string | null;
  attestation: {
    doctor_name: string;
    credential_type: string;
    credential_number: string;
    attested_at: string;
    statement: string | null;
  } | null;
}

const NOT_FOUND: PassportVerification = {
  verdict: "not_found",
  serial: null,
  issuer: "TarragonHealth",
  issuerDomain: "tarragonhealth.ng",
  issuedAt: null,
  expiresAt: null,
  revokedAt: null,
  contentDigest: null,
  signingKid: null,
  signingAlgorithm: null,
  signatureValid: false,
  signatureDetail: null,
  subjectNameMasked: null,
  subjectYearOfBirth: null,
  subjectName: null,
  subjectPatientRef: null,
  identityConfirmed: false,
  identityRejected: false,
  attestation: null,
};

/** Tolerate however a human typed it; the RPC normalises the same way. */
export function normaliseSerial(input: string): string | null {
  const stripped = input.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^THP[0-9A-HJKMNP-TV-Z]{16}$/.test(stripped)) return null;
  return `THP-${stripped.slice(3, 7)}-${stripped.slice(7, 11)}-${stripped.slice(11, 15)}-${stripped.slice(15, 19)}`;
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Does the signed payload actually describe THIS record?
 *
 * Checking the signature alone is not enough. A validly-signed credential from a
 * different passport, pasted into this row, would pass a naive signature check
 * while asserting somebody else's identity. So every field the credential and
 * the record both carry has to agree, and any disagreement is treated as a
 * failure rather than resolved in either direction.
 */
function claimsMatchRecord(payload: CredentialPayload, row: RpcPayload): string | null {
  if (payload.serial !== row.serial) return "the signed reference does not match this record";
  if (payload.content_digest !== row.content_digest) {
    return "the signed content digest does not match this record";
  }
  if (payload.kid !== row.signing_kid) return "the signed key id does not match this record";
  if (new Date(payload.issued_at).getTime() !== new Date(row.issued_at).getTime()) {
    return "the signed issue date does not match this record";
  }
  if (new Date(payload.expires_at).getTime() !== new Date(row.expires_at).getTime()) {
    return "the signed expiry date does not match this record";
  }
  const signedAttestation = payload.attestation;
  const rowAttestation = row.attestation;
  if (Boolean(signedAttestation) !== Boolean(rowAttestation)) {
    return "the signed attestation does not match this record";
  }
  if (signedAttestation && rowAttestation) {
    if (
      signedAttestation.doctor_name !== rowAttestation.doctor_name ||
      signedAttestation.credential_type !== rowAttestation.credential_type ||
      signedAttestation.credential_number !== rowAttestation.credential_number
    ) {
      return "the signed attesting doctor does not match this record";
    }
  }
  return null;
}

function checkSignature(row: RpcPayload): { valid: boolean; detail: string | null } {
  if (!row.signed_payload || !row.signature) {
    return { valid: false, detail: "this record carries no signature" };
  }
  if (!row.signing_public_key) {
    return { valid: false, detail: "the signing key for this document is not published" };
  }
  const key = publicKeyFromSpkiBase64(row.signing_public_key);
  if (!key) return { valid: false, detail: "the published signing key could not be read" };

  if (!verifySignature(row.signed_payload, base64UrlDecode(row.signature), key)) {
    return { valid: false, detail: "the signature does not match the signed content" };
  }

  const parsed = credentialPayloadSchema.safeParse(JSON.parse(row.signed_payload));
  if (!parsed.success) {
    return { valid: false, detail: "the signed content is not a TarragonHealth credential" };
  }
  const mismatch = claimsMatchRecord(parsed.data, row);
  if (mismatch) return { valid: false, detail: mismatch };

  return { valid: true, detail: null };
}

/**
 * Look up and verify a passport.
 *
 * `dateOfBirth` is the optional identity challenge. Supplying it correctly
 * releases the full legal name; supplying it wrongly releases nothing and is
 * counted towards the throttle enforced inside the RPC. Not supplying it at all
 * is the normal first page load.
 */
export async function verifyPassportBySerial(
  serialInput: string,
  dateOfBirth?: string | null
): Promise<PassportVerification> {
  const serial = normaliseSerial(serialInput);
  if (!serial) return NOT_FOUND;

  const supabase = anonClient();
  if (!supabase) return NOT_FOUND;

  const { data, error } = await supabase.rpc("health_passport_by_serial", {
    p_serial: serial,
    p_dob: dateOfBirth ?? undefined,
  });
  if (error || !data) return NOT_FOUND;

  const row = data as unknown as RpcPayload;
  const signature = checkSignature(row);

  // Authenticity gates everything. A document whose signature does not verify is
  // reported as unverifiable regardless of what the status column says — the
  // status of a document we cannot prove we issued is not a useful answer.
  //
  // The database's 'valid' becomes 'genuine' here on purpose: 'valid' is a
  // statement about a row, and what this surface reports is a statement about a
  // document, which only holds once the signature has also passed.
  const verdict: PassportVerdict = !signature.valid
    ? "unverifiable"
    : row.status === "valid"
      ? "genuine"
      : row.status;

  return {
    verdict,
    serial: row.serial,
    issuer: row.issuer,
    issuerDomain: row.issuer_domain,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    contentDigest: row.content_digest,
    signingKid: row.signing_kid,
    signingAlgorithm: row.signing_algorithm,
    signatureValid: signature.valid,
    signatureDetail: signature.detail,
    subjectNameMasked: row.subject_name_masked,
    subjectYearOfBirth: row.subject_year_of_birth,
    subjectName: row.subject_name,
    subjectPatientRef: row.subject_patient_number,
    identityConfirmed: row.identity_confirmed,
    identityRejected: Boolean(dateOfBirth) && !row.identity_confirmed,
    attestation: row.attestation
      ? {
          doctorName: row.attestation.doctor_name,
          credentialType: row.attestation.credential_type,
          credentialNumber: row.attestation.credential_number,
          attestedAt: row.attestation.attested_at,
          statement: row.attestation.statement,
        }
      : null,
  };
}
