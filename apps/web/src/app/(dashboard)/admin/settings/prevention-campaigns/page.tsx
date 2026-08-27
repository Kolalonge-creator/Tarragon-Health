import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "./campaign-form";
import { CampaignManager, type PreventionCampaignRow } from "./campaign-manager";

/**
 * Population-level prevention campaigns (spec §2.16) — "Heart Health Month"
 * style time-boxed initiatives. A campaign is created as a draft (visible
 * only to staff), then activated when ready; ending it is one-way.
 */
export default async function PreventionCampaignsSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("prevention_campaigns")
    .select("id, code, name, description, starts_on, ends_on, status, actions")
    .eq("organisation_id", profile.organisation_id ?? "")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Prevention campaigns</h1>
        <p className="text-charcoal-ink/60">
          Time-boxed, population-level initiatives — education, screening invitations, extra
          assessments, partner offers, and challenges targeted at an eligible subset of patients
          based on their own risk profile.
        </p>
      </div>
      <CampaignForm />
      <CampaignManager campaigns={(campaigns as PreventionCampaignRow[] | null) ?? []} />
    </div>
  );
}
