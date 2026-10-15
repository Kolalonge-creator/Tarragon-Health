import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { PrnLimitRulesPanel } from "../../../clinician/_signoff-panels/prn-limit-rules-panel";

export const metadata = { title: "As-needed medicine limits" };

/** Admin view of the as-needed limits rule. Only the Chief Medical Officer can sign it; the database enforces that. */
export default async function PrnLimitRulesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="As-needed medicine limits"
        description="The bounds a clinician may set for an as-needed medicine, and the rule for flagging repeated doses. An admin may open a draft; the Chief Medical Officer signs."
      />
      <PrnLimitRulesPanel />
    </div>
  );
}
