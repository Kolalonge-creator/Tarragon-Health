import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { NutritionTargetsConfigView } from "@/app/(dashboard)/clinician/nutrition-targets-config/nutrition-targets-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/nutrition-targets-config). */
export default async function AdminNutritionTargetsConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("nutrition_target_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Nutrition targets" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The nutrition targets configuration could not be loaded.</p> : <NutritionTargetsConfigView row={data} canSign={false} />}
    </div>
  );
}
