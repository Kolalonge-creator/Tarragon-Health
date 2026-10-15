import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { parseWindow } from "@/lib/workload/model";
import { WorkloadPage } from "@/components/workload/workload-page";

export const metadata = { title: "Clinician workload" };
export const dynamic = "force-dynamic";

/** S78c: the Chief Medical Officer's workload dashboard. CMO only; the database function refuses anyone else and audits every read. */
export default async function ClinicianWorkload({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const { days } = await searchParams;
  return <WorkloadPage days={parseWindow(days)} />;
}
