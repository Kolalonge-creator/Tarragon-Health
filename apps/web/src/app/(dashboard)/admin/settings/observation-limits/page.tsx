import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { ObservationLimitsView } from "@/app/(dashboard)/clinician/observation-limits/observation-limits-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/observation-limits). */
export default async function AdminObservationLimitsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("observation_limit_signoffs")
    .select("id, version, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Limits for typed numbers" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The limits could not be loaded.</p> : <ObservationLimitsView row={data} canSign={false} />}
    </div>
  );
}
