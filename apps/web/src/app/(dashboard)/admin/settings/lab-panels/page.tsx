import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { readLabPanels } from "@/lib/lab-results/read-lab-panels";
import { PageHeader } from "@/components/ui/page-header";
import { LabPanelsView } from "@/app/(dashboard)/clinician/lab-panels/lab-panels-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/lab-panels). */
export default async function AdminLabPanelsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { signoff, panels, loadFailed } = await readLabPanels(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Lab ranges and release policy" description="Read only. The Chief Medical Officer signs these." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The lab ranges could not be loaded.</p> : <LabPanelsView signoff={signoff} panels={panels} canSign={false} />}
    </div>
  );
}
