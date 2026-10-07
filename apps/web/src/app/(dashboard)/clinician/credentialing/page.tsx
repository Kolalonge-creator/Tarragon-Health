import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { QueuePage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Clinician applications" };
export const dynamic = "force-dynamic";

/** Chief Medical Officer only. Their account role is `clinician`, so this mirrors /admin/credentialing under /clinician. */
export default async function ClinicianCredentialingPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <QueuePage basePath="/clinician/credentialing" isCmo searchParams={searchParams} />;
}
