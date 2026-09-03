import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Provider quality</h1>
        <p className="text-charcoal-ink/60">
          Operational, documentation, and patient-experience performance by metric (never a
          single provider score, §29.10), plus the roster&apos;s credential status and the
          complaints pipeline. Clinical quality indicators appear only once a Clinical Director
          has validated and signed one off.
        </p>
      </div>
      <ProviderQualityDashboard />
    </div>
  );
}
