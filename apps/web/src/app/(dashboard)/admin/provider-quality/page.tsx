import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderQualityDashboard } from "./provider-quality-dashboard";

/**
 * Provider Quality & Performance Management (spec module §29). Server-side
 * gate mirrors `private.is_complaints_handler()` (admin, or an active
 * Clinical Director) — the DB is the real gate (every RPC/table here
 * self-scopes and returns `{}`/an empty list to anyone else), this is just
 * the page-guard so the wrong audience doesn't even load the shell.
 */
export default async function ProviderQualityPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  const isHandler = profile.role === "admin" || staff?.is_clinical_director === true;
  if (!isHandler) redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider quality"
        description="Operational, documentation, and patient-experience performance by metric (never a single provider score, §29.10), plus the roster's credential status and the complaints pipeline. Clinical quality indicators appear only once a Clinical Director has validated and signed one off."
      />
      <ProviderQualityDashboard />
    </div>
  );
}
