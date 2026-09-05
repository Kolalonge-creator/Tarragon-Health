"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { requestCampaignFromTemplateAction, type RequestCampaignState } from "./actions";

export function RequestCampaignButton({ templateId }: { templateId: string }) {
  const [state, action, pending] = useActionState<RequestCampaignState, FormData>(
    () => requestCampaignFromTemplateAction(templateId),
    undefined,
  );

  if (state?.success) {
    return <p className="text-sm text-brand-green">Requested. Awaiting review.</p>;
  }

  return (
    <form action={action}>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Requesting…" : "Request for our organisation"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
