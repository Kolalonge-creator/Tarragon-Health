import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { guardLeafMarkPng } from "./brand-assets";
import { CREDENTIAL_ALGORITHM } from "./credential";
import {
  HealthPassportDocument,
  type PassportCredentialView,
} from "./health-passport-document";
import type { HealthPassportData } from "./get-health-passport-data";
import { passportCompactCredential, passportSnapshot, passportVerifyUrl, type PassportIssuance } from "./issue";
import { offlineCredentialQrPng, verifyQrPng } from "./qr";

/**
 * Turn a sealed issuance into the actual file.
 *
 * Everything here comes off the frozen issuance row — the content snapshot, the
 * signature, the identity as at issue. Nothing is re-read from live tables, so
 * downloading the same serial in six months produces the same document with the
 * same fingerprint, which is the only way the printed fingerprint means
 * anything.
 */
export async function renderPassportPdf(issuance: PassportIssuance): Promise<Buffer | null> {
  const snapshot = passportSnapshot(issuance);
  if (!snapshot || !issuance.content_digest || !issuance.signature || !issuance.signing_kid) {
    return null;
  }

  const verifyUrl = passportVerifyUrl(issuance.serial);
  const compact = passportCompactCredential(issuance);

  const [verifyQrDataUri, offlineQrDataUri] = await Promise.all([
    verifyQrPng(verifyUrl),
    compact ? offlineCredentialQrPng(compact) : Promise.resolve(null),
  ]);

  const credential: PassportCredentialView = {
    serial: issuance.serial,
    issuedAt: issuance.issued_at,
    expiresAt: issuance.expires_at,
    contentDigest: issuance.content_digest,
    signature: issuance.signature,
    signingKid: issuance.signing_kid,
    algorithm: CREDENTIAL_ALGORITHM,
    verifyUrl,
    verifyQrDataUri,
    offlineQrDataUri,
    compact,
    subjectDateOfBirth: issuance.subject_dob,
    subjectPatientRef: issuance.subject_patient_number,
    // Rendered from the SNAPSHOTTED attestation on the issuance, never from a
    // live join to the doctor's record. If that doctor later leaves or their
    // record is edited, a passport already sitting in an embassy's file must
    // keep saying exactly what the embassy read.
    attestation:
      issuance.attested_by &&
      issuance.attesting_doctor_name &&
      issuance.attesting_credential_type &&
      issuance.attesting_credential_number &&
      issuance.attested_at
        ? {
            doctorName: issuance.attesting_doctor_name,
            credentialType: issuance.attesting_credential_type,
            credentialNumber: issuance.attesting_credential_number,
            attestedAt: issuance.attested_at,
            statement: issuance.attestation_statement,
          }
        : null,
  };

  return renderToBuffer(
    HealthPassportDocument({
      patientName: issuance.subject_name,
      data: snapshot,
      credential,
      markPng: guardLeafMarkPng(),
    })
  );
}

/**
 * The fallback when no signing key is configured on this deployment.
 *
 * The patient still gets their record — refusing to hand someone their own
 * health data because of a missing environment variable would be a worse product
 * than the unsigned PDF this feature replaced. What it must never do is imply
 * verifiability it does not have, so it carries no serial, no QR and no
 * verification panel, and says on its face that it cannot be checked.
 */
export async function renderUnsignedPassportPdf(
  patientName: string,
  data: HealthPassportData,
  documentTitle = "Health Passport"
): Promise<Buffer> {
  return renderToBuffer(
    HealthPassportDocument({
      patientName,
      data,
      documentTitle,
      credential: null,
      markPng: guardLeafMarkPng(),
    })
  );
}
