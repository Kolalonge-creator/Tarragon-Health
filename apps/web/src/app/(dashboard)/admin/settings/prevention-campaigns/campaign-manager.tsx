"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setCampaignStatusAction, type SetCampaignStatusState } from "./actions";

export type PreventionCampaignRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  starts_on: string;
  ends_on: string | null;
  status: "draft" | "active" | "ended";
  actions: unknown;
};

/** Cross-org rows where an employer corporate_admin requested a template —
 * see dashboard/corporate/programmes/actions.ts. */
export type RequestedCampaignRow = PreventionCampaignRow & {
  organisations: { name: string } | null;
  requested_by_profile: { full_name: string | null } | null;
};

const STATUS_BADGE = {
  draft: "grey",
  active: "green",
  ended: "grey",
} as const;

function StatusButton({ campaignId, status }: { campaignId: string; status: "active" | "ended" }) {
  const [state, action, pending] = useActionState<SetCampaignStatusState, FormData>(
    () => setCampaignStatusAction(campaignId, status),
    undefined
  );
  return (
    <form action={action} className="inline">
      <Button type="submit" size="sm" variant={status === "ended" ? "outline" : "default"} disabled={pending}>
        {pending ? "…" : status === "active" ? "Activate" : "End campaign"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

function CampaignCard({ c, subtitle }: { c: PreventionCampaignRow; subtitle?: string }) {
  const actions = Array.isArray(c.actions) ? (c.actions as { type: string; detail: string }[]) : [];
  return (
    <Card key={c.id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {c.name}
          <Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge>
        </CardTitle>
        {subtitle && <p className="text-xs text-charcoal-ink/50">{subtitle}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {c.description && <p className="text-sm text-charcoal-ink/70">{c.description}</p>}
        <p className="text-xs text-charcoal-ink/50">
          {c.starts_on}
          {c.ends_on ? ` – ${c.ends_on}` : " (ongoing)"}
        </p>
        {actions.length > 0 && (
          <ul className="list-inside list-disc text-xs text-charcoal-ink/60">
            {actions.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.type.split("_").join(" ")}:</span> {a.detail}
              </li>
            ))}
          </ul>
        )}
        {c.status === "draft" && <StatusButton campaignId={c.id} status="active" />}
        {c.status === "active" && <StatusButton campaignId={c.id} status="ended" />}
      </CardContent>
    </Card>
  );
}

export function CampaignManager({
  campaigns,
  requestedCampaigns = [],
}: {
  campaigns: PreventionCampaignRow[];
  /** Cross-org rows an employer requested from a template — reviewed and
   * activated the same way as any other draft, see actions.ts. */
  requestedCampaigns?: RequestedCampaignRow[];
}) {
  return (
    <div className="space-y-6">
      {requestedCampaigns.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Requested by employers</h2>
          {requestedCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              subtitle={`${c.organisations?.name ?? "Unknown organisation"} · requested by ${
                c.requested_by_profile?.full_name ?? "unknown"
              }`}
            />
          ))}
        </div>
      )}
      <div className="space-y-4">
        {requestedCampaigns.length > 0 && (
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Your campaigns</h2>
        )}
        {campaigns.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No campaigns yet.</p>
        ) : (
          campaigns.map((c) => <CampaignCard key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}
