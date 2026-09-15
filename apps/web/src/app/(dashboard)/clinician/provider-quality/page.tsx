import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderQualityDashboard } from "@/app/(dashboard)/admin/provider-quality/provider-quality-dashboard";

/**
 * Provider Quality & Performance Management (spec module §29) — the Chief
 * Medical Officer / Clinical Director's own reachable path. Mirrors
 * /clinician/team-caseload's pattern: `admin/provider-quality/page.tsx`
 * already carries the CORRECT dual-gate (`profile.role === "admin" ||
 * staff?.doctor_tier === "chief_medical_officer"`), but proxy.ts refuses a
 * plain `clinician` login on any /admin/** route before that page-level
 * check ever runs, so a real CMO (account role always `clinician`, per
 * CLAUDE.md's "never re-split the account role" rule) could not reach it at
 * all. Reuses ProviderQualityDashboard as-is, pointed at this page's own
 * complaint-detail path so a followed complaint link doesn't run into the
 * same /admin/** wall. Found and audited 2026-09-14.
 */
export default async function ClinicianProviderQualityPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  const isHandler = profile.role === "admin" || staff?.doctor_tier === "chief_medical_officer";
  if (!isHandler) redirect("/clinician");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider quality"
        description="Operational, documentation, and patient-experience performance by metric (not a single provider score, §29.10), plus the roster's credential status and the complaints pipeline. Clinical quality indicators appear only once a Clinical Director has validated and signed one off."
      />
      <ProviderQualityDashboard complaintsBasePath="/clinician/provider-quality/complaints" />
    </div>
  );
}
