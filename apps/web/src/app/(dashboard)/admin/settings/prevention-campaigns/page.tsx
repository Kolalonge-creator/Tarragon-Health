import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { CampaignForm } from "./campaign-form";
import {
  CampaignManager,
  type PreventionCampaignRow,
  type RequestedCampaignRow,
} from "./campaign-manager";

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
  const [{ data: campaigns }, { data: requested }] = await Promise.all([
    supabase
      .from("prevention_campaigns")
      .select("id, code, name, description, starts_on, ends_on, status, actions, population_id")
      .eq("organisation_id", profile.organisation_id ?? "")
      .order("created_at", { ascending: false }),
    // Cross-org on purpose — an employer's request needs a superadmin to see
    // it regardless of which org authored it. private.is_org_staff() already
    // permits role='admin' for any organisation (role = 'admin' or
    // organisation_id = org), so this is a pure app-code query change, not
    // an RLS change.
    supabase
      .from("prevention_campaigns")
      .select(
        "id, code, name, description, starts_on, ends_on, status, actions, population_id, organisations(name), requested_by_profile:profiles!prevention_campaigns_requested_by_fkey(full_name)"
      )
      .not("requested_by", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const { data: populations } = await supabase
    .from("population_definitions")
    .select("id, name")
    .eq("organisation_id", profile.organisation_id ?? "")
    .eq("status", "active")
    .order("name");

  const rows = (campaigns as PreventionCampaignRow[] | null) ?? [];
  const requestedRows = (requested as unknown as RequestedCampaignRow[] | null) ?? [];
  const effectivenessByCampaign: Record<string, unknown> = {};
  await Promise.all(
    [...rows, ...requestedRows]
      .filter((c) => c.population_id)
      .map(async (c) => {
        const { data } = await supabase.rpc("get_campaign_effectiveness", { p_campaign_id: c.id });
        effectivenessByCampaign[c.id] = data;
      })
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prevention campaigns"
        description="Time-boxed, population-level initiatives: education, screening invitations, extra assessments, partner offers, and challenges targeted at an eligible subset of patients based on their own risk profile."
      />
      <CampaignForm populations={populations ?? []} />
      <CampaignManager
        campaigns={rows}
        requestedCampaigns={requestedRows}
        effectivenessByCampaign={effectivenessByCampaign}
      />
    </div>
  );
}
