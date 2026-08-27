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

export function CampaignManager({ campaigns }: { campaigns: PreventionCampaignRow[] }) {
  if (campaigns.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No campaigns yet.</p>;
  }
  return (
    <div className="space-y-4">
      {campaigns.map((c) => {
        const actions = Array.isArray(c.actions) ? (c.actions as { type: string; detail: string }[]) : [];
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {c.name}
                <Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge>
              </CardTitle>
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
      })}
    </div>
  );
}
