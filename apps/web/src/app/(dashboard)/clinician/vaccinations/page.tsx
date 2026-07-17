import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  VaccinationVerificationList,
  type PendingVerificationItem,
} from "./verification-list";

const SIGNED_URL_TTL_SECONDS = 600;

/**
 * Tarragon care-team worklist of patient-uploaded vaccination certificates
 * awaiting verification. The pending list is fetched under the caller's own
 * RLS-scoped session (so it is already org-scoped); the uploaded image itself
 * is fetched via a short-lived signed URL minted server-side — the storage
 * bucket is private and has no staff-read policy by design.
 */
export default async function ClinicianVaccinationsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: records } = user
    ? await supabase
        .from("vaccination_records")
        .select(
          "id, dose_number, date_administered, provider, physical_certificate_path, created_at, profiles!vaccination_records_profile_id_fkey(full_name, patient_number), vaccination_catalog(name)",
        )
        .eq("verification_status", "pending_verification")
        .order("created_at", { ascending: true })
    : { data: null };

  const service = createServiceRoleClient();
  const items: PendingVerificationItem[] = await Promise.all(
    (records ?? []).map(async (record) => {
      let signedUrl: string | null = null;
      if (record.physical_certificate_path) {
        const { data } = await service.storage
          .from("vaccination-certificates")
          .createSignedUrl(record.physical_certificate_path, SIGNED_URL_TTL_SECONDS);
        signedUrl = data?.signedUrl ?? null;
      }
      const isPdf = (record.physical_certificate_path ?? "").toLowerCase().endsWith(".pdf");
      return {
        id: record.id,
        patientName: record.profiles?.full_name ?? "Patient",
        patientNumber: record.profiles?.patient_number ?? null,
        vaccineName: record.vaccination_catalog?.name ?? "Vaccine",
        doseNumber: record.dose_number,
        dateAdministered: record.date_administered,
        provider: record.provider,
        uploadedAt: record.created_at,
        signedUrl,
        isPdf,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Vaccination certificates
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Review the physical certificate each patient uploaded. Verifying confirms the dose was
          truly received, issues the patient&apos;s Tarragon certificate, and schedules their next
          dose.
        </p>
      </div>
      <VaccinationVerificationList items={items} />
    </div>
  );
}
