import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { MyHealthConfigView } from "@/app/(dashboard)/clinician/my-health-config/my-health-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/my-health-config). */
export default async function AdminMyHealthConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("my_health_config")
    .select("id, version, approved_at, created_at, config")
    .eq("is_active", true)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="My Health lock-screen pass" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The My Health configuration could not be loaded.</p> : <MyHealthConfigView row={data} canSign={false} />}
    </div>
  );
}
