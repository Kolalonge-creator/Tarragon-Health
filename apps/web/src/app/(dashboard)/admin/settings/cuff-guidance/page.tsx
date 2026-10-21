import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { readCuffGuidance } from "@/lib/home-bp/read-cuff-guidance";
import { PageHeader } from "@/components/ui/page-header";
import { CuffGuidanceView } from "@/app/(dashboard)/clinician/cuff-guidance/cuff-guidance-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/cuff-guidance). */
export default async function AdminCuffGuidancePage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { live, pending, loadFailed } = await readCuffGuidance(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Home blood pressure cuff sizes" description="Read only. The Chief Medical Officer signs this." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The cuff size guidance could not be loaded.</p> : <CuffGuidanceView live={live} pending={pending} canSign={false} />}
    </div>
  );
}
