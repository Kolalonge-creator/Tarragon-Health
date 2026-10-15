import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { PrnLimitRulesPanel } from "../_signoff-panels/prn-limit-rules-panel";

export const metadata = { title: "As-needed medicine limits" };

/**
 * The Chief Medical Officer's own path to the as-needed (PRN) limits rule (S08x, decision C7). Approved text,
 * not yet signed. The same panel opens inline in the sign-off hub.
 */
export default async function ClinicianPrnLimitRulesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  return (
    <div className="space-y-6">
      <PageHeader
        title="As-needed medicine limits"
        description="The bounds a clinician may set for an as-needed medicine (a shortest gap and a daily most), and the rule for flagging repeated doses. A dose is always logged; the patient is told to check with the care team."
      />
      <PrnLimitRulesPanel />
    </div>
  );
}
