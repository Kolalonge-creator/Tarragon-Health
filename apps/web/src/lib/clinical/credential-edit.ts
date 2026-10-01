import { isPlaceholderCredentialNumber } from "@/lib/prescriptions/prescription-pdf-data";

/**
 * Validation for editing an existing doctor's registration on the admin clinical-staff page.
 *
 * Both fields are required together, and a placeholder (`MDCN-PENDING-…`, blank, "TBC") is refused here as
 * well as at issue time: a number typed in as a stand-in is exactly what would otherwise appear on a
 * prescription. Returns `unchanged` when nothing differs, so the caller sends no credential columns at
 * all (changing them clears credential_verified_at, see private.clear_credential_verification_on_change).
 */
export type CredentialEditResult =
  | { status: "unchanged" }
  | { status: "ok"; credentialType: string; credentialNumber: string }
  | { status: "error"; message: string };

export function parseCredentialEdit(
  input: { credentialType: string; credentialNumber: string },
  current: { credential_type: string | null; credential_number: string | null },
): CredentialEditResult {
  const type = input.credentialType.trim();
  const number = input.credentialNumber.trim();
  if (type === (current.credential_type ?? "") && number === (current.credential_number ?? "")) {
    return { status: "unchanged" };
  }
  if (!type || !number) {
    return { status: "error", message: "Enter both the registration body (for example MDCN) and the number." };
  }
  if (isPlaceholderCredentialNumber(number)) {
    return { status: "error", message: "That looks like a placeholder. Enter the real registration number." };
  }
  if (number.length > 40 || type.length > 20) {
    return { status: "error", message: "That is too long to be a registration number." };
  }
  return { status: "ok", credentialType: type, credentialNumber: number };
}
