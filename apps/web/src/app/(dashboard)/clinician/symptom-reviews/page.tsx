import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { SymptomReviewsPage } from "@/components/symptom/symptom-reviews-page";

export const metadata = { title: "Symptom check reviews" };
export const dynamic = "force-dynamic";

/** S60: a clinician's symptom check reviews. Any clinician; the database refuses a care coordinator and any patient without a held task. */
export default async function ClinicianSymptomReviews({ searchParams }: { searchParams: Promise<{ review?: string; r?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!staff) redirect("/clinician");
  const q = await searchParams;
  return <SymptomReviewsPage reviewId={q.review} outcome={q.r} />;
}
