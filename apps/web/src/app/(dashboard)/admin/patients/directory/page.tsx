import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadDirectory } from "@/lib/admin-patient-directory/load";
import { queryInput } from "@/lib/admin-patient-directory/model";
import { LoadFailure } from "@/components/ui/load-failure";
import { DirectoryTable } from "./directory-table";

export const metadata = { title: "Patient directory" };
export const dynamic = "force-dynamic";

/**
 * Every patient on the platform with membership, sign-in, activity and time-on-platform facts, opened from the "Total patients" tile.
 * Admin only (institutions see aggregates only, I9). No date of birth, email or clinical data; phone masked. Every view is written
 * to the audit log, and the Excel download needs a typed reason (see migration 20261029194436_admin_patient_directory.sql).
 */
export default async function AdminPatientDirectoryPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const first = await loadDirectory(await createClient(), queryInput.parse({}));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Patient directory</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everyone on the platform, with their plan, when they joined, last sign-in and activity, and an estimate of time spent. No date of
          birth, email or clinical record is shown, and phone numbers are masked. Every view and every download is written to the audit log.
        </p>
        <p className="mt-2 flex gap-4 text-sm">
          <Link className="underline" href="/admin/patients">Find one patient and open their record</Link>
          <Link className="underline" href="/admin">Back to the dashboard</Link>
        </p>
      </div>
      {first.ok ? (
        <DirectoryTable initial={first.page} />
      ) : (
        <LoadFailure>The patient directory could not be loaded. Nothing here should be read as zero patients. Reload to try again.</LoadFailure>
      )}
    </div>
  );
}
