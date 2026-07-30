export type AccountabilityModel = "tech_layer" | "provider";

export interface ClinicianSignatureInput {
  clinicianName: string;
  mdcnNumber: string;
  accountabilityModel: AccountabilityModel;
}

/**
 * Spec §4: the patient-facing signature block on a clinical_notes row
 * differs by accountability_model. Pure function, no I/O — the caller
 * passes in accountability_model_at_signing (the value stored on the row
 * at signing time), never the current app_config value, so a later model
 * switch never rewrites how a historical note reads.
 */
export function renderClinicianSignatureBlock(
  input: ClinicianSignatureInput,
): string {
  const { clinicianName, mdcnNumber, accountabilityModel } = input;

  switch (accountabilityModel) {
    case "tech_layer":
      return `${clinicianName} · MDCN ${mdcnNumber} · practising under own registration`;
    case "provider":
      return `${clinicianName} · MDCN ${mdcnNumber} · on behalf of Tarragon Health Ltd`;
    default: {
      const exhaustiveCheck: never = accountabilityModel;
      throw new Error(`Unhandled accountability_model: ${exhaustiveCheck}`);
    }
  }
}
