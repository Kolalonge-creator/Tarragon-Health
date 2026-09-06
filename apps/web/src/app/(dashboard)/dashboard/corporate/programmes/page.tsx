import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isCohortSuppressed } from "@/lib/institutions/suppression";
import { loadCorporateDashboardData } from "../dashboard-data";
import { RequestCampaignButton } from "./request-campaign-button";

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "ended";
  template_id: string | null;
  starts_on: string;
  ends_on: string | null;
};

const STATUS_LABEL: Record<CampaignRow["status"], string> = {
  draft: "Requested (awaiting review)",
  active: "Active",
  ended: "Ended",
};
const STATUS_BADGE: Record<CampaignRow["status"], "grey" | "green"> = {
  draft: "grey",
  active: "green",
  ended: "grey",
};

/**
 * Employer-facing half of Engagement/Retention gap #4 — a corporate_admin
 * requests a Tarragon-curated campaign template for their own org (never
 * authors eligibility rules themselves, see actions.ts) and sees only
 * aggregate enrolment counts for what they've requested, never a per-member
 * list (I9). Only ever rendered when layout.tsx has already established the
 * "ready" state — see corporate/page.tsx's own note on that convention.
 */
export default async function CorporateProgrammesPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  const { client, organisationId, minCohortSize } = data.access;

  const [templatesResult, campaignsResult] = await Promise.all([
    client
      .from("campaign_templates")
      .select("id, code, name, description")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    client
      .from("prevention_campaigns")
      .select("id, name, status, template_id, starts_on, ends_on")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
  ]);

  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const campaigns = (campaignsResult.data ?? []) as CampaignRow[];
  const campaignByTemplateId = new Map(
    campaigns.filter((c) => c.template_id).map((c) => [c.template_id as string, c]),
  );

  const campaignIds = campaigns.map((c) => c.id);
  const enrolmentCounts = new Map<string, { joined: number; completed: number }>();
  if (campaignIds.length > 0) {
    const { data: enrolments } = await client
      .from("prevention_campaign_enrolments")
      .select("campaign_id, status")
      .in("campaign_id", campaignIds);
    for (const row of enrolments ?? []) {
      const bucket = enrolmentCounts.get(row.campaign_id) ?? { joined: 0, completed: 0 };
      if (row.status !== "declined") bucket.joined += 1;
      if (row.status === "completed") bucket.completed += 1;
      enrolmentCounts.set(row.campaign_id, bucket);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Available programmes</CardTitle>
          <CardDescription>
            Time-boxed wellness programmes you can request for your organisation: screening
            drives, vaccination pushes, activity challenges, and education campaigns. A Tarragon
            admin reviews each request before it goes live; we never share individual employee
            health information as part of running one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {templates.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No programmes available right now.</p>
          )}
          {templates.map((template) => {
            const existing = campaignByTemplateId.get(template.id);
            return (
              <div key={template.id} className="rounded-lg border border-charcoal-ink/10 p-4">
                <p className="font-heading text-sm font-semibold text-charcoal-ink">{template.name}</p>
                {template.description && (
                  <p className="mt-1 text-sm text-charcoal-ink/70">{template.description}</p>
                )}
                <div className="mt-3">
                  {existing ? (
                    <Badge variant={STATUS_BADGE[existing.status]}>{STATUS_LABEL[existing.status]}</Badge>
                  ) : (
                    <RequestCampaignButton templateId={template.id} />
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your programmes</CardTitle>
            <CardDescription>
              Aggregate participation only: individual employee results are never shown here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaigns.map((campaign) => {
              const counts = enrolmentCounts.get(campaign.id) ?? { joined: 0, completed: 0 };
              const suppressed = isCohortSuppressed(counts.joined, minCohortSize);
              return (
                <div key={campaign.id} className="rounded-lg border border-charcoal-ink/10 p-4">
                  <div className="flex items-center gap-2">
                    <p className="font-heading text-sm font-semibold text-charcoal-ink">{campaign.name}</p>
                    <Badge variant={STATUS_BADGE[campaign.status]}>{STATUS_LABEL[campaign.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/50">
                    {campaign.starts_on}
                    {campaign.ends_on ? ` – ${campaign.ends_on}` : " (ongoing)"}
                  </p>
                  {campaign.status !== "draft" && (
                    <p className="mt-2 text-sm text-charcoal-ink/70">
                      {suppressed
                        ? "Not enough participants yet to report on."
                        : `${counts.joined} joined, ${counts.completed} completed`}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
