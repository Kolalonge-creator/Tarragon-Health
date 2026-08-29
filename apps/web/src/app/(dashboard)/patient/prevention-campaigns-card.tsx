import { createClient } from "@/lib/supabase/server";
import { ageFromDateOfBirth, type Enums } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { Predicate } from "@/lib/rules/predicate";
import { buildCampaignEligibilityContext, isEligibleForCampaign } from "@/lib/prevention-campaigns/eligibility";
import { JoinCampaignButton } from "./join-campaign-button";

interface EligibleCampaign {
  id: string;
  name: string;
  description: string | null;
  actions: { type: string; detail: string }[];
  joined: boolean;
}

async function resolveEligibleCampaigns(patientId: string): Promise<EligibleCampaign[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [profileResult, campaignsResult, scoresResult, enrolmentsResult] = await Promise.all([
    supabase.from("profiles").select("sex, date_of_birth, organisation_id").eq("id", patientId).single(),
    supabase
      .from("prevention_campaigns")
      .select("id, name, description, eligibility_rule, actions, starts_on, ends_on")
      .eq("status", "active")
      .lte("starts_on", today),
    supabase
      .from("prevention_risk_scores")
      .select("condition, tier, computed_at")
      .eq("profile_id", patientId)
      .order("computed_at", { ascending: false }),
    supabase.from("prevention_campaign_enrolments").select("campaign_id").eq("patient_id", patientId),
  ]);

  const profile = profileResult.data;
  if (!profile) return [];

  const latestTierByCondition = new Map<string, Enums<"risk_level">>();
  for (const row of scoresResult.data ?? []) {
    if (!latestTierByCondition.has(row.condition)) {
      latestTierByCondition.set(row.condition, row.tier);
    }
  }
  const context = buildCampaignEligibilityContext(
    { sex: profile.sex, ageYears: ageFromDateOfBirth(profile.date_of_birth) },
    latestTierByCondition,
  );

  const joinedCampaignIds = new Set((enrolmentsResult.data ?? []).map((e) => e.campaign_id));

  return (campaignsResult.data ?? [])
    .filter((c) => !c.ends_on || c.ends_on >= today)
    .filter((c) => isEligibleForCampaign(c.eligibility_rule as Predicate, context))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      actions: Array.isArray(c.actions) ? (c.actions as { type: string; detail: string }[]) : [],
      joined: joinedCampaignIds.has(c.id),
    }));
}

/**
 * "Heart Health Month"-style population campaigns (spec §2.16), filtered to
 * the ones this patient is actually eligible for — computed server-side
 * against their own profile + their own current risk tiers, the same data
 * they can already see on the Risk Assessment tab. Self-hides when there
 * are none, same convention as the other conditional dashboard cards.
 */
export async function PreventionCampaignsCard({ patientId }: { patientId: string }) {
  const campaigns = await resolveEligibleCampaigns(patientId);
  if (campaigns.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          For you right now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="rounded-lg border border-charcoal-ink/10 p-4">
            <p className="font-heading text-sm font-semibold text-charcoal-ink">{campaign.name}</p>
            {campaign.description && (
              <p className="mt-1 text-sm text-charcoal-ink/70">{campaign.description}</p>
            )}
            {campaign.actions.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-charcoal-ink/60">
                {campaign.actions.map((a, i) => (
                  <li key={i}>{a.detail}</li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              {campaign.joined ? (
                <Button size="sm" variant="outline" disabled>
                  Joined
                </Button>
              ) : (
                <JoinCampaignButton campaignId={campaign.id} />
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
