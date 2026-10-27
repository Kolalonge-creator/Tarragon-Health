import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { HomeCardConfigView } from "@/app/(dashboard)/clinician/home-card-config/home-card-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/home-card-config). */
export default async function AdminHomeCardConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("home_card_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Today screen, weekly summary and readiness" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The Today screen configuration could not be loaded.</p> : <HomeCardConfigView row={data} canSign={false} />}
    </div>
  );
}
