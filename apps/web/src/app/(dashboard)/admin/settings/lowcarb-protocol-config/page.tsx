import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LowCarbProtocolConfigView } from "@/app/(dashboard)/clinician/lowcarb-protocol-config/lowcarb-protocol-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/lowcarb-protocol-config). */
export default async function AdminLowCarbProtocolConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("lowcarb_protocol_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Low-carbohydrate programme rules" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The low-carbohydrate programme rules could not be loaded.</p> : <LowCarbProtocolConfigView row={data} canSign={false} />}
    </div>
  );
}
