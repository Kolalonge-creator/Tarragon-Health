import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { ComplaintDetailView } from "@/app/(dashboard)/admin/provider-quality/complaints/[id]/complaint-detail-view";

/**
 * §29.5 complaint detail, reached from /clinician/provider-quality. Same
 * gate and same ComplaintDetailView as the admin route
 * (admin/provider-quality/complaints/[id]/page.tsx) — see that page's own
 * comment and /clinician/provider-quality/page.tsx's comment for why a
 * separate /clinician/* route exists instead of reusing the /admin/** URL.
 */
export default async function ClinicianProviderComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  const isHandler = profile.role === "admin" || staff?.doctor_tier === "chief_medical_officer";
  if (!isHandler) redirect("/clinician");

  return (
    <div className="space-y-6">
      <ComplaintDetailView
        complaintId={id}
        callerClinicalStaffId={staff?.id ?? null}
        callerIsClinicalDirector={staff?.doctor_tier === "chief_medical_officer"}
      />
    </div>
  );
}
