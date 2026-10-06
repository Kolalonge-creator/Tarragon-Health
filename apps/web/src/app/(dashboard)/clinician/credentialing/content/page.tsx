import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { ContentPage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Training and test content" };
export const dynamic = "force-dynamic";

export default async function ClinicianCredentialingContent({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <ContentPage basePath="/clinician/credentialing" searchParams={searchParams} />;
}
