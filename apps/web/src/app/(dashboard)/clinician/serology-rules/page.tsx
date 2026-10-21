import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { SerologyRulesPanel } from "../_signoff-panels/serology-rules-panel";

/** The Chief Medical Officer's own path to confirm the anti-HBs threshold. The database refuses anyone else. */
export default async function ClinicianSerologyRulesPage() {
  if (!canAssignCases(await getCurrentClinicalStaff())) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Hepatitis and HIV repeat rules" description="How often each blood test repeats, and the anti-HBs level that records hepatitis B immunity." />
      <SerologyRulesPanel />
    </div>
  );
}
