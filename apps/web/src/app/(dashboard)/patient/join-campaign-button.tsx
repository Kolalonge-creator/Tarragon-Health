"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { joinPreventionCampaignAction, type JoinCampaignState } from "./prevention-campaigns-actions";

export function JoinCampaignButton({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState<JoinCampaignState, FormData>(
    () => joinPreventionCampaignAction(campaignId),
    undefined
  );
  return (
    <form action={action}>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Joining…" : "Join"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{state.error}</p>}
    </form>
  );
}
