"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";

export type RequestCampaignState = { error?: string; success?: boolean } | undefined;

/**
 * An employer corporate_admin requesting a pre-vetted campaign template for
 * their own org (Engagement/Retention gap #4). Deliberately never accepts
 * an eligibility_rule/actions payload from the caller — those come only
 * from the Tarragon-curated campaign_templates row, copied verbatim, so an
 * employer admin can never author a rule that could leak clinical
 * categorisation structure (I9). Writes through
 * requireInstitutionAggregateAccess()'s service-role client because
 * prevention_campaigns' own RLS correctly excludes corporate_admin from
 * INSERT — this is the one narrow, verified doorway, not a new RLS policy.
 * Lands as status='draft' (same as an admin-authored campaign) so it stays
 * invisible to patients until a Tarragon admin reviews and activates it.
 */
export async function requestCampaignFromTemplateAction(
  templateId: string,
): Promise<RequestCampaignState> {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) return { error: "Not authorised" };

  const access = await requireInstitutionAggregateAccess(profile.organisation_id);
  if (!access) return { error: "Not authorised" };

  const { data: template, error: templateError } = await access.client
    .from("campaign_templates")
    .select("code, name, description, default_duration_days, eligibility_rule, actions")
    .eq("id", templateId)
    .eq("is_active", true)
    .single();
  if (templateError || !template) return { error: "Template not found" };

  const startsOn = new Date().toISOString().slice(0, 10);
  const endsOn = template.default_duration_days
    ? new Date(Date.now() + template.default_duration_days * 86400_000).toISOString().slice(0, 10)
    : null;

  const { error } = await access.client.from("prevention_campaigns").insert({
    organisation_id: access.organisationId,
    code: `${template.code}-${access.organisationId.slice(0, 8)}-${Date.now()}`,
    name: template.name,
    description: template.description,
    starts_on: startsOn,
    ends_on: endsOn,
    eligibility_rule: template.eligibility_rule,
    actions: template.actions,
    status: "draft",
    template_id: templateId,
    requested_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/corporate/programmes");
  return { success: true };
}
