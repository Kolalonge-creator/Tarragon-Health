import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { NutritionGuidanceConfigView } from "@/app/(dashboard)/clinician/nutrition-guidance-config/nutrition-guidance-config-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/nutrition-guidance-config). */
export default async function AdminNutritionGuidanceConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { data, error } = await (await createClient())
    .from("nutrition_guidance_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Eating plans and food swaps" description="Read only. The Chief Medical Officer signs this." />
      {error ? <p role="alert" className="text-sm text-red-700">The eating plans configuration could not be loaded.</p> : <NutritionGuidanceConfigView row={data} canSign={false} />}
    </div>
  );
}
