import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { ExpiryPage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Licences and cover" };
export const dynamic = "force-dynamic";

export default async function ClinicianCredentialingExpiry({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <ExpiryPage basePath="/clinician/credentialing" isCmo searchParams={searchParams} />;
}
