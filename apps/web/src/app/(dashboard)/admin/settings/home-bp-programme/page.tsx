import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { readHomeBpProgramme } from "@/lib/home-bp/read-home-bp-programme";
import { PageHeader } from "@/components/ui/page-header";
import { HomeBpProgrammeView } from "@/app/(dashboard)/clinician/home-bp-programme/home-bp-programme-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/home-bp-programme). */
export default async function AdminHomeBpProgrammePage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { live, pending, loadFailed } = await readHomeBpProgramme(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Home blood pressure programme" description="Read only. The Chief Medical Officer signs this." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The programme could not be loaded.</p> : <HomeBpProgrammeView live={live} pending={pending} canSign={false} />}
    </div>
  );
}
