import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { GlucoseTriageRulesPanel } from "../_signoff-panels/glucose-triage-rules-panel";

export const metadata = { title: "Glucose triage rules" };
export const dynamic = "force-dynamic";

export default async function GlucoseTriageRulesPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Glucose triage rules"
        description="The rules that grade a glucose reading, with ketones and symptoms, as red, amber or green, and what each grade does. Until you sign, results are graded in shadow only and the older glucose alerts keep running. Signing is your clinical decision. It is not done for you."
      />
      {sp.done && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{sp.done}</p>}
      {sp.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{sp.error}</p>}
      <GlucoseTriageRulesPanel />
    </div>
  );
}
