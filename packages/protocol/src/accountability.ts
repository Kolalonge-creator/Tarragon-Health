/**
 * Clinical accountability model (build spec v3 §4). Renders the note signature block a patient
 * reads on every clinical_notes-backed message/note, under whichever accountability model was
 * in force at signing time.
 *
 * Always render from clinical_notes.accountability_model_at_signing (stamped server-side, see
 * migration v3_m2_clinical_notes_accountability_stamp), never from live app_config -- §4:
 * "Store the model in force on every signature row so historical notes remain interpretable
 * after a switch." The one exception is a not-yet-signed note preview, which reads the live
 * app_config value since there is no signed row yet.
 */

export type AccountabilityModel = "tech_layer" | "provider";

export interface ClinicianSignatureInfo {
  fullName: string;
  mdcnNumber: string;
}

export interface SignatureBlock {
  /** e.g. "Dr A. Adetunbi — MDCN 12345" */
  clinicianLine: string;
  /** The model-specific disclosure clause, exactly as specified in §4's table. */
  disclosureLine: string;
  /** clinicianLine + disclosureLine, ready to render as one line. */
  fullText: string;
}

const DISCLOSURE_LINE: Record<AccountabilityModel, string> = {
  tech_layer: "practising under own registration",
  provider: "on behalf of Tarragon Health Ltd",
};

export function getSignatureBlock(
  clinician: ClinicianSignatureInfo,
  model: AccountabilityModel
): SignatureBlock {
  const clinicianLine = `Dr ${clinician.fullName} — MDCN ${clinician.mdcnNumber}`;
  const disclosureLine = DISCLOSURE_LINE[model];
  return { clinicianLine, disclosureLine, fullText: `${clinicianLine}, ${disclosureLine}` };
}
