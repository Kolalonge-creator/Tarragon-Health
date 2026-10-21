import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SerologyRulesPanel } from "@/app/(dashboard)/clinician/_signoff-panels/serology-rules-panel";

/** Read only for admin: confirming the threshold is the Chief Medical Officer's alone (see /clinician/serology-rules). */
export default async function AdminSerologyRulesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  return (
    <div className="space-y-6">
      <PageHeader title="Hepatitis and HIV repeat rules" description="Read only. The Chief Medical Officer confirms the threshold." />
      <SerologyRulesPanel canSign={false} />
    </div>
  );
}
