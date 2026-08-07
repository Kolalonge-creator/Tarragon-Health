import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@tarragon/shared";
import { getHealthPassportData, type HealthPassportData } from "./get-health-passport-data";
import {
  CREDENTIAL_ALGORITHM,
  VERIFY_ISSUER,
  VERIFY_ISSUER_DOMAIN,
  canonicalize,
  contentDigest,
  credentialPayloadSchema,
  encodeCompact,
  type CredentialPayload,
} from "./credential";
import { getSigner } from "./signing-key";

/**
 * Issuing a passport: mint, sign, seal.
 *
 * The order matters and is not an implementation detail. The database mints
 * first and hands back the identity and attestation it holds; this module signs
 * *what the database said*, never what a caller passed in. So the worst a
 * tampered client can achieve is a row with a signature that fails verification
 * — which is exactly the outcome the verify route is built to report.
 */

export type PassportIssuance = Tables<"health_passport_issuances">;

/** What `mint_health_passport` hands back. Mirrors its jsonb_build_object. */
interface MintResult {
  id: string;
  serial: string;
  organisation_id: string;
  subject_name: string;
  subject_dob: string | null;
  subject_patient_number: string | null;
  issued_at: string;
  expires_at: string;
  attestation: {
    doctor_name: string;
    credential_type: string;
    credential_number: string;
    attested_at: string;
    statement: string | null;
    purpose: string;
  } | null;
}

/** Where a verifier goes. Short on purpose — it is printed, scanned and dictated. */
export function passportVerifyUrl(serial: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.APP_BASE_URL ??
    `https://${VERIFY_ISSUER_DOMAIN}`;
  return `${base.replace(/\/$/, "")}/v/${serial}`;
}

/**
 * The passport the patient is currently carrying, if any.
 *
 * Re-downloading must return THE SAME document, not issue a new one. A patient
 * who has already handed a PDF to a consulate and then taps "download" again
 * would otherwise silently supersede the copy under review — the document would
 * still be genuine, but the verify page would tell the consulate it had been
 * replaced, which is precisely the sort of unexplained red flag that loses an
 * application. Issuing a replacement is therefore a deliberate, separate action.
 */
export async function getCurrentPassport(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<PassportIssuance | null> {
  const { data } = await supabase
    .from("health_passport_issuances")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "valid")
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Expiry is derived here rather than in the page, deliberately.
 *
 * A passport lapses by the passage of time, not by anything writing to it, so
 * "has it expired" needs a clock — and reading a clock inside a component's
 * render is impure (React flags it, correctly: the same render would produce
 * different output at different moments). The query layer is where a clock
 * legitimately belongs, and it is the same clock the `getCurrentPassport` filter
 * already uses, so the two cannot disagree.
 */
export type PassportIssuanceView = PassportIssuance & { isExpired: boolean };

export async function listPassports(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<PassportIssuanceView[]> {
  const { data } = await supabase
    .from("health_passport_issuances")
    .select("*")
    .eq("patient_id", patientId)
    .neq("status", "unsigned")
    .order("issued_at", { ascending: false })
    .limit(25);

  const now = Date.now();
  return (data ?? []).map((row) => ({
    ...row,
    isExpired: new Date(row.expires_at).getTime() <= now,
  }));
}

export type IssueFailure =
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "mint_failed"; message: string }
  | { ok: false; reason: "seal_failed"; message: string };

export type IssueResult = { ok: true; issuance: PassportIssuance } | IssueFailure;

/**
 * Mint, sign and seal a new passport.
 *
 * Returns `not_configured` rather than throwing when no signing key is present.
 * That is a deployment state, not an error the patient caused, and the caller
 * turns it into an honest unsigned document rather than a failure — see
 * `signing-key.ts` for why an unsigned passport is an acceptable degradation and
 * a fabricated signature never is.
 */
export async function issueHealthPassport(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string,
  options: { attestationRequestId?: string | null } = {}
): Promise<IssueResult> {
  const signer = getSigner();
  if (!signer) return { ok: false, reason: "not_configured" };

  const { data: minted, error: mintError } = await supabase.rpc("mint_health_passport", {
    p_attestation_request_id: options.attestationRequestId ?? undefined,
  });
  if (mintError || !minted) {
    return { ok: false, reason: "mint_failed", message: mintError?.message ?? "no issuance returned" };
  }
  const mint = minted as unknown as MintResult;

  // Read the clinical content ONCE, here, and freeze it. Everything downstream —
  // the digest, the signature, every future re-render of this serial — works off
  // this exact object. A passport that quietly tracked live data would make its
  // own signature meaningless the first time a new reading arrived.
  const snapshot = await getHealthPassportData(supabase, patientId, organisationId);
  const digest = contentDigest(snapshot);

  const payload: CredentialPayload = credentialPayloadSchema.parse({
    v: 1,
    typ: "health-passport",
    iss: VERIFY_ISSUER,
    iss_domain: VERIFY_ISSUER_DOMAIN,
    alg: CREDENTIAL_ALGORITHM,
    kid: signer.kid,
    serial: mint.serial,
    issued_at: mint.issued_at,
    expires_at: mint.expires_at,
    sub: {
      name: mint.subject_name,
      dob: mint.subject_dob,
      patient_ref: mint.subject_patient_number,
    },
    content_digest: digest,
    attestation: mint.attestation
      ? {
          doctor_name: mint.attestation.doctor_name,
          credential_type: mint.attestation.credential_type,
          credential_number: mint.attestation.credential_number,
          attested_at: mint.attestation.attested_at,
          statement: mint.attestation.statement,
        }
      : null,
  });

  const canonicalPayload = canonicalize(payload);
  const signature = signer.sign(canonicalPayload);

  const { error: sealError } = await supabase.rpc("seal_health_passport", {
    p_issuance_id: mint.id,
    p_content_snapshot: snapshot as unknown as Database["public"]["Tables"]["health_passport_issuances"]["Row"]["content_snapshot"],
    p_content_digest: digest,
    p_signed_payload: canonicalPayload,
    p_signature: signature,
    p_kid: signer.kid,
  });
  if (sealError) {
    return { ok: false, reason: "seal_failed", message: sealError.message };
  }

  const { data: sealed } = await supabase
    .from("health_passport_issuances")
    .select("*")
    .eq("id", mint.id)
    .single();

  if (!sealed) {
    return { ok: false, reason: "seal_failed", message: "sealed row could not be read back" };
  }
  return { ok: true, issuance: sealed };
}

/**
 * The frozen clinical content of an already-issued passport.
 *
 * Falls back to null rather than re-querying live data if the snapshot is
 * somehow absent: rendering fresh data under an old serial would produce a
 * document whose printed digest did not match its own contents, which is worse
 * than rendering nothing.
 */
export function passportSnapshot(issuance: PassportIssuance): HealthPassportData | null {
  if (!issuance.content_snapshot) return null;
  return issuance.content_snapshot as unknown as HealthPassportData;
}

/** `THP1.<payload>.<signature>` — the offline-verifiable string. */
export function passportCompactCredential(issuance: PassportIssuance): string | null {
  if (!issuance.signed_payload || !issuance.signature) return null;
  return encodeCompact(issuance.signed_payload, issuance.signature);
}
