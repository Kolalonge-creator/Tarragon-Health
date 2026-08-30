import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { CareVisibilityList } from "../family/care-visibility-list";
import { ConsentStatusPanel } from "./consent-status-panel";
import { ConnectedDevicesSummary } from "./connected-devices-summary";
import { DataRightsPanel } from "./data-rights-panel";

/**
 * Privacy & data centre, docs spec §87.7. Composes what already exists
 * elsewhere (consent status, CareVisibilityList — reused, not rebuilt) with
 * what this gap-closure pass added: a self-service DSAR export
 * (§87.8) and the two request workflows (§87.9 correction, §87.11
 * deletion). There is deliberately no "which org staff can see me" section
 * here — no such feature exists anywhere on the platform to surface (org
 * staff access is governed by RLS, not by a patient-visible access log),
 * and this page should not fabricate one.
 */
export default async function PrivacyCentrePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            Privacy &amp; your data
          </h1>
          <p className="text-charcoal-ink/60">
            What you&apos;ve agreed to, who can see your record, and how to export, correct, or delete
            your data.
          </p>
        </div>
        <Link
          href="/api/patient/data-export"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Download your data
        </Link>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ConsentStatusPanel patientId={profile.id} />
        <ConnectedDevicesSummary patientId={profile.id} />
      </div>

      <CareVisibilityList />

      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Your data rights</h2>
        <p className="mb-3 text-sm text-charcoal-ink/60">
          Under Nigeria&apos;s Data Protection Act, you can ask to see, correct, or delete the data we
          hold about you.
        </p>
        <DataRightsPanel patientId={profile.id} />
      </div>
    </div>
  );
}
