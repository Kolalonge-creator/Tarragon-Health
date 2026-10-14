import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { AccessReviewPage } from "@/components/security/access-review-page";

export const metadata = { title: "Record access review" };
export const dynamic = "force-dynamic";

export default async function ClinicianAccessReview() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <AccessReviewPage />;
}
