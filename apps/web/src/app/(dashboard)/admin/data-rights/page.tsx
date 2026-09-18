import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { DataRightsReviewDashboard } from "./data-rights-review-dashboard";

export const metadata = { title: "Data rights requests" };

/**
 * Admin review queue for the three patient DSAR request tables
 * (data_export_requests, data_deletion_requests, data_correction_requests
 * — §87.8/§87.9/§87.11). The patient-facing side (Privacy Centre's
 * DataRightsPanel) and the DB-level RLS/attribution triggers letting an
 * admin move these off "pending" have existed since 2026-08-29/09-07; this
 * page is the missing admin-facing other half, so a submitted request has
 * somewhere to actually be reviewed and actioned instead of sitting
 * unreachable. Admin-role only: data_export_requests/data_deletion_requests
 * RLS only ever admits private.is_admin(), and while data_correction_requests
 * admits any org staff, this platform runs a single organisation and every
 * other similarly sensitive cross-patient console (e.g. /admin/patients)
 * already draws this same line.
 */
export default async function AdminDataRightsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data rights requests"
        icon={SEMANTIC_ICON.privacy}
        description="Review and action patient requests to export, correct, or delete their data under Nigeria's Data Protection Act."
      />
      <DataRightsReviewDashboard />
    </div>
  );
}
