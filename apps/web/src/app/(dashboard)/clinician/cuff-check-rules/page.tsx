import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { CuffCheckRulesPanel } from "../_signoff-panels/cuff-check-rules-panel";

/** The Chief Medical Officer's own path to sign the home cuff vs clinic cuff rule (S07y). The database refuses anyone else. */
export default async function ClinicianCuffCheckRulesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Home cuff vs clinic cuff check" description="When the patient's own cuff reads differently from the clinic cuff, the care team is asked to consider a cuff check. Clinician-only." />
      <CuffCheckRulesPanel />
    </div>
  );
}
