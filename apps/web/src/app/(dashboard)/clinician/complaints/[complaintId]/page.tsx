import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { getCurrentUser } from "@/lib/supabase/server";
import { StaffComplaintDetail } from "./staff-complaint-detail";

export default async function ClinicianComplaintDetailPage({ params }: { params: Promise<{ complaintId: string }> }) {
  const { complaintId } = await params;
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  const user = await getCurrentUser();

  // Mirrors private.can_review_complaint_governance(org): an admin, or the
  // org's Clinical Director. Only gates whether the governance_review
  // control renders — the RPC's own check is the real enforcement.
  const canReviewGovernance = profile?.role === "admin" || staff?.is_clinical_director === true;

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Complaint</h1>
      <StaffComplaintDetail
        complaintId={complaintId}
        canReviewGovernance={canReviewGovernance}
        currentProfileId={user?.id ?? null}
      />
    </div>
  );
}
