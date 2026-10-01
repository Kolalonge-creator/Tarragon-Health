import { controlledSubstanceInfo } from "@/lib/rules/controlled-substances";

/**
 * The patient-side prescription PDF: eligibility rules and the data the document prints.
 *
 * Pure on purpose (no I/O, no React) so the issuing rules are tested without a database. The route
 * loads the rows through the caller's own RLS session and hands them here; this decides whether a
 * document may be issued at all. A refusal is a typed reason with patient-readable wording, never a
 * silently empty or partly filled document.
 *
 * Issuing rules (docs/PRESCRIPTION_PDF_SCOPE.md section 4):
 *  - clinician-sourced, active, not superseded, not expired, with an Rx number and verification code
 *  - the prescriber's licence is currently verified and the credential number is a real one
 *  - not a controlled medicine: TarragonHealth does not prescribe those, so a match is refused rather
 *    than printed (the matcher is a curated advisory list, so this is a guard, not a classification)
 */

export interface PrescriptionSource {
  id: string;
  patient_id: string;
  source: string;
  is_active: boolean;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  quantity: string | null;
  duration_days: number | null;
  repeats_allowed: number | null;
  indication: string | null;
  instructions: string | null;
  rx_number: string | null;
  verification_code: string | null;
  expires_at: string | null;
  version: number;
  superseded_at: string | null;
  created_at: string;
  amendment_reason: string | null;
}

export interface PrescriptionPatient {
  full_name: string | null;
  patient_number: string | null;
  date_of_birth: string | null;
}

export interface PrescriptionPrescriber {
  name: string | null;
  credentialType: string | null;
  credentialNumber: string | null;
  /** `clinical_staff_directory.license_verified`: verified and not past its expiry. */
  licenseVerified: boolean;
}

export type PrescriptionRefusalReason =
  | "not_prescribed_by_clinician"
  | "stopped"
  | "superseded"
  | "expired"
  | "missing_identifiers"
  | "prescriber_unverified"
  | "controlled_medicine";

export type PrescriptionPdfResult =
  | { status: "ok"; data: PrescriptionPdfData }
  | { status: "refused"; reason: PrescriptionRefusalReason; message: string };

export interface PrescriptionPdfData {
  medicationId: string;
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  drugName: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  quantity: string | null;
  durationDays: number | null;
  repeatsAllowed: number;
  indication: string | null;
  instructions: string | null;
  rxNumber: string;
  verificationCode: string;
  version: number;
  /** Set for an amendment: why the earlier version was replaced. */
  amendmentReason: string | null;
  signedAt: string;
  validUntil: string | null;
  prescriberName: string;
  prescriberCredential: string;
}

export const REFUSAL_MESSAGE: Record<PrescriptionRefusalReason, string> = {
  not_prescribed_by_clinician:
    "Only a medicine prescribed by your TarragonHealth care team has a prescription document. A medicine you added yourself does not.",
  stopped: "This medicine has been stopped, so there is no current prescription to download.",
  superseded:
    "This prescription was replaced by a newer version. Download the current version from your medicines list.",
  expired: "This prescription has expired. Ask your care team to renew it.",
  missing_identifiers:
    "This prescription is missing its reference number, so a document cannot be issued. Contact your care team.",
  prescriber_unverified:
    "We cannot issue this document yet because the prescriber's registration details are not confirmed on our side. Contact your care team and they will sort it out.",
  controlled_medicine:
    "TarragonHealth does not prescribe controlled medicines, and this document cannot be issued for one. Contact your care team.",
};

/** A credential number that is still a stand-in (for example `MDCN-PENDING-…`) must never print on a medical document. */
export function isPlaceholderCredentialNumber(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return true;
  return /\b(pending|placeholder|tbc|tbd|none|unknown|test)\b|\bn\/a\b/i.test(trimmed);
}

function refuse(reason: PrescriptionRefusalReason): PrescriptionPdfResult {
  return { status: "refused", reason, message: REFUSAL_MESSAGE[reason] };
}

export function buildPrescriptionPdfData(input: {
  medication: PrescriptionSource;
  patient: PrescriptionPatient;
  prescriber: PrescriptionPrescriber | null;
  now?: Date;
}): PrescriptionPdfResult {
  const { medication, patient, prescriber } = input;
  const now = input.now ?? new Date();

  if (medication.source !== "clinician") return refuse("not_prescribed_by_clinician");
  // Superseded is checked before inactive: an amendment deactivates the old row too, and "replaced by a
  // newer version" is the more useful message for it than "stopped".
  if (medication.superseded_at) return refuse("superseded");
  if (!medication.is_active) return refuse("stopped");
  if (medication.expires_at && new Date(medication.expires_at).getTime() < now.getTime()) return refuse("expired");
  if (!medication.rx_number || !medication.verification_code) return refuse("missing_identifiers");
  if (controlledSubstanceInfo(medication.drug_name)) return refuse("controlled_medicine");
  if (
    !prescriber ||
    !prescriber.name ||
    !prescriber.licenseVerified ||
    !prescriber.credentialType ||
    isPlaceholderCredentialNumber(prescriber.credentialNumber)
  ) {
    return refuse("prescriber_unverified");
  }

  return {
    status: "ok",
    data: {
      medicationId: medication.id,
      patientName: patient.full_name?.trim() || "Patient",
      patientNumber: patient.patient_number,
      dateOfBirth: patient.date_of_birth,
      drugName: medication.drug_name,
      dose: medication.dose,
      frequency: medication.frequency,
      route: medication.route,
      quantity: medication.quantity,
      durationDays: medication.duration_days,
      repeatsAllowed: medication.repeats_allowed ?? 0,
      indication: medication.indication,
      instructions: medication.instructions,
      rxNumber: medication.rx_number,
      verificationCode: medication.verification_code,
      version: medication.version,
      amendmentReason: medication.version > 1 ? medication.amendment_reason : null,
      signedAt: medication.created_at,
      validUntil: medication.expires_at,
      prescriberName: prescriber.name.trim(),
      prescriberCredential: `${prescriber.credentialType} ${(prescriber.credentialNumber ?? "").trim()}`,
    },
  };
}

/** A current prescription the document could not include, named so the patient is told rather than left to notice. */
export interface SkippedPrescription {
  drugName: string;
  reason: PrescriptionRefusalReason;
  message: string;
}

/** Everything the bundle may print: the eligible rows, and the refused ones (the caller attaches drug names). */
export function buildPrescriptionBundle(
  items: ReadonlyArray<PrescriptionPdfResult>,
): { included: PrescriptionPdfData[]; refused: Extract<PrescriptionPdfResult, { status: "refused" }>[] } {
  const included: PrescriptionPdfData[] = [];
  const refused: Extract<PrescriptionPdfResult, { status: "refused" }>[] = [];
  for (const item of items) {
    if (item.status === "ok") included.push(item.data);
    else refused.push(item);
  }
  return { included, refused };
}
