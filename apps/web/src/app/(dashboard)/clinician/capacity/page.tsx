import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { CapacityPage } from "@/components/capacity/capacity-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Capacity and cover" };
export const dynamic = "force-dynamic";

export default async function ClinicianCapacity({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  // Chief Medical Officer only; the database checks every read and write too
  if (!canAssignCases(staff)) redirect("/clinician");
  return <CapacityPage basePath="/clinician/capacity" isCmo searchParams={searchParams} />;
}
