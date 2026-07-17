import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export interface VaccinationCertificateData {
  patientName: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  provider: string | null;
  serial: string;
  issuedAt: string;
  verifiedAt: string;
  /** Null-gated verifying-doctor attribution, same rule as ReviewedByDoctor —
   * a generic care-team line renders when no clinical_staff match is found. */
  verifier: {
    fullName: string;
    credentialType: string | null;
    credentialNumber: string | null;
  } | null;
}

/**
 * Assembles the data for a patient's Tarragon vaccination certificate. Runs
 * under the caller's own RLS-scoped session, so it only returns a record the
 * caller may see. Returns null unless the dose is actually verified (has a
 * Tarragon serial) — a certificate never exists for an unverified dose.
 */
export async function getVaccinationCertificateData(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<VaccinationCertificateData | null> {
  const { data: record } = await supabase
    .from("vaccination_records")
    .select(
      "dose_number, date_administered, provider, verification_status, verified_by, verified_at, tarragon_certificate_serial, tarragon_certificate_issued_at, vaccination_catalog(name), profiles!vaccination_records_profile_id_fkey(full_name)",
    )
    .eq("id", recordId)
    .maybeSingle();

  if (
    !record ||
    record.verification_status !== "verified" ||
    !record.tarragon_certificate_serial ||
    !record.tarragon_certificate_issued_at ||
    !record.verified_at
  ) {
    return null;
  }

  let verifier: VaccinationCertificateData["verifier"] = null;
  if (record.verified_by) {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("profile_id", record.verified_by)
      .eq("active", true)
      .maybeSingle();
    if (staff) {
      verifier = {
        fullName: staff.full_name,
        credentialType: staff.credential_type,
        credentialNumber: staff.credential_number,
      };
    }
  }

  return {
    patientName: record.profiles?.full_name ?? "Patient",
    vaccineName: record.vaccination_catalog?.name ?? "Vaccination",
    doseNumber: record.dose_number,
    dateAdministered: record.date_administered,
    provider: record.provider,
    serial: record.tarragon_certificate_serial,
    issuedAt: record.tarragon_certificate_issued_at,
    verifiedAt: record.verified_at,
    verifier,
  };
}
