import { redirect } from "next/navigation";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { ReliabilityPage } from "@/components/reliability/reliability-page";

export const metadata = { title: "Reliability and SLA" };
export const dynamic = "force-dynamic";

/** S36e: the Chief Medical Officer's reliability and SLA dashboard, with the named list. CMO only; the database function refuses anyone else. */
export default async function ClinicianReliability() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = DEFAULT_UI_LANGUAGE;
  return <ReliabilityPage viewer="lead" locale={locale} />;
}
