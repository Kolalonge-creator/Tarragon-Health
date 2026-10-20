import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { ActivitySafetyConfigView } from "@/app/(dashboard)/clinician/activity-safety-config/activity-safety-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/activity-safety-config). */
export default async function AdminActivitySafetyConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("activity_safety_config")
    .select("id, version, approved_at, created_at, config")
    .eq("is_active", true)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Activity safety rules" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The activity safety rules could not be loaded.</p> : <ActivitySafetyConfigView row={data} canSign={false} />}
    </div>
  );
}
