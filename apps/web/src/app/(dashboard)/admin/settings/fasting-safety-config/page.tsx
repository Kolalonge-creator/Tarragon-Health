import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { FastingSafetyConfigView } from "@/app/(dashboard)/clinician/fasting-safety-config/fasting-safety-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/fasting-safety-config). */
export default async function AdminFastingSafetyConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("fasting_safety_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Fasting safety rules" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The fasting safety rules could not be loaded.</p> : <FastingSafetyConfigView row={data} canSign={false} />}
    </div>
  );
}
