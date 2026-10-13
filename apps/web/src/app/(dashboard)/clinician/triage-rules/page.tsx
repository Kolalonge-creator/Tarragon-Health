import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { TriageRulesPanel } from "../_signoff-panels/triage-rules-panel";

export const metadata = { title: "Blood pressure triage rules" };
export const dynamic = "force-dynamic";

export default async function TriageRulesPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blood pressure triage rules"
        description="The rules that grade a blood pressure reading as red, amber or green, and what each grade does. Until you sign, results are graded but shadow only: nothing new is paged or opened as a clinical task from them. Signing is your clinical decision. It is not done for you."
      />
      {sp.done && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{sp.done}</p>}
      {sp.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{sp.error}</p>}
      <TriageRulesPanel />
    </div>
  );
}
