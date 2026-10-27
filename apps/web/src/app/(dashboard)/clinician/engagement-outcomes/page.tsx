import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { OutcomesDashboardPage } from "@/components/outcomes/outcomes-dashboard-page";

export const metadata = { title: "Engagement and outcomes" };
export const dynamic = "force-dynamic";

/** The same page for the Chief Medical Officer, whose account role (`clinician`) can never open /admin. CMO only. */
export default async function ClinicianEngagementOutcomes({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <OutcomesDashboardPage viewer="cmo" outcome={(await searchParams).r} />;
}
