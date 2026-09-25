import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import { LoadFailure } from "@/components/ui/load-failure";
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

  const { data: records, error: recordsError } = user
    ? await supabase
        .from("vaccination_records")
        .select(
          "id, dose_number, date_administered, provider, physical_certificate_path, created_at, profiles!vaccination_records_profile_id_fkey(full_name, patient_number), vaccination_catalog(name)",
        )
        .eq("verification_status", "pending_verification")
        .order("created_at", { ascending: true })
    : { data: null, error: null };

  // One batched Storage call for every pending certificate's signed URL
  // instead of one request per record — previously an N+1 that fired a
  // separate signed-URL request per row in the verification queue. See
  // lib/supabase/sign-storage-paths.ts for the shared batching
  // implementation and its request-level-failure-logging note: a batch
  // failure now zeroes out every certificate's signedUrl at once instead of
  // costing just one, which — exactly the silent-failure risk this file's
  // own comment above already warns about for an empty queue — would
  // otherwise render identically to "nothing is pending".
  const certificatePaths = (records ?? [])
    .map((record) => record.physical_certificate_path)
    .filter((path): path is string => !!path);
  const signedUrlByPath = await signStoragePaths(
    "vaccination-certificates",
    certificatePaths,
    SIGNED_URL_TTL_SECONDS,
  );

  const items: PendingVerificationItem[] = (records ?? []).map((record) => {
    const signedUrl = record.physical_certificate_path
      ? (signedUrlByPath.get(record.physical_certificate_path) ?? null)
      : null;
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
  });

  return (
    <div className="space-y-6">
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
      {/* An empty verification queue reads as "every uploaded certificate has
          been checked". A patient whose dose is unverified gets no Tarragon
          certificate and no next dose scheduled, so silence here has a real
          downstream cost. */}
      {recordsError ? (
        <LoadFailure>
          The certificate queue could not be loaded. This is not a report that nothing is waiting
          to be verified. Reload to try again.
        </LoadFailure>
      ) : (
        <VaccinationVerificationList items={items} />
      )}
    </div>
  );
}
