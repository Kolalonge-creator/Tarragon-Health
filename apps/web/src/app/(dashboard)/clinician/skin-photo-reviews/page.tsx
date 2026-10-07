import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { SkinPhotoReviewsPage } from "@/components/symptom/skin-photo-reviews-page";

export const metadata = { title: "Photo reviews" };
export const dynamic = "force-dynamic";

/** S59 (spec 12.7): photos patients sent for the care team to look at. Any clinician; the database refuses a care coordinator and any patient without a held task. */
export default async function ClinicianSkinPhotoReviews({ searchParams }: { searchParams: Promise<{ photo?: string; r?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!staff) redirect("/clinician");
  const q = await searchParams;
  return <SkinPhotoReviewsPage photoId={q.photo} outcome={q.r} />;
}
