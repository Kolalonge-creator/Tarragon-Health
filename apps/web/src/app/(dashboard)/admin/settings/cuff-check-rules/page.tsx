import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { readCuffCheckRules } from "@/lib/cuff-check/read-cuff-check-rules";
import { PageHeader } from "@/components/ui/page-header";
import { CuffCheckRulesView } from "@/app/(dashboard)/clinician/cuff-check-rules/cuff-check-rules-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/cuff-check-rules). */
export default async function AdminCuffCheckRulesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { live, pending, loadFailed } = await readCuffCheckRules(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Home cuff vs clinic cuff check" description="Read only. The Chief Medical Officer signs this." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The rule could not be loaded.</p> : <CuffCheckRulesView live={live} pending={pending} canSign={false} />}
    </div>
  );
}
