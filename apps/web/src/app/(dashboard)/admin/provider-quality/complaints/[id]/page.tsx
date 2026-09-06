import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { ComplaintDetailView } from "./complaint-detail-view";

/**
 * §29.5 complaint detail — handler view. Gate mirrors the dashboard page's:
 * admin, or an active Clinical Director. A complainant reading their own
 * complaint, or a subject provider reading theirs from provider_response
 * onward, both reach the complaint through their own patient/clinician
 * dashboards instead — this /admin route is the handler workspace.
 */
export default async function ProviderComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  const isHandler = profile.role === "admin" || staff?.is_clinical_director === true;
  if (!isHandler) redirect("/admin");

  return (
    <div className="space-y-6">
      <ComplaintDetailView
        complaintId={id}
        callerClinicalStaffId={staff?.id ?? null}
        callerIsClinicalDirector={staff?.is_clinical_director === true}
      />
    </div>
  );
}
