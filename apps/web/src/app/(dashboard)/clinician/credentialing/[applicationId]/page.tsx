import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { DetailPage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Review application" };
export const dynamic = "force-dynamic";

export default async function ClinicianCredentialingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: SearchParams;
}) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const { applicationId } = await params;
  if (!z.uuid().safeParse(applicationId).success) notFound();
  return <DetailPage basePath="/clinician/credentialing" isCmo applicationId={applicationId} searchParams={searchParams} />;
}
