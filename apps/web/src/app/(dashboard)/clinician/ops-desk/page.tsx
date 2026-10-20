import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { OpsDeskPage } from "@/components/ops-desk/ops-desk-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Ops desk" };
export const dynamic = "force-dynamic";

/** The chief medical officer's read of the ops desk and the resilience checklist. A CMO login cannot open /admin/*, so this lives under /clinician. */
export default async function ClinicianOpsDesk({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <OpsDeskPage mode="cmo" searchParams={searchParams} />;
}
