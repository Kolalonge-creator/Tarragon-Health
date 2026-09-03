"use client";

import { useActionState } from "react";
import { submitHomeCareRequest } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function HomeCareRequestForm() {
  const [state, formAction, pending] = useActionState(submitHomeCareRequest, undefined);

  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor="home-care-reason">What&apos;s going on?</Label>
      <Textarea id="home-care-reason" name="reason" maxLength={500} required />
      {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Sent. Your care coordinator will follow up.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Request a home visit"}
      </Button>
    </form>
  );
}
