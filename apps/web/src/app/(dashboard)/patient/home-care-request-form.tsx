"use client";

import { useActionState } from "react";
import { submitHomeCareRequest } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

export function HomeCareRequestForm() {
  const [state, formAction, pending] = useActionState(submitHomeCareRequest, undefined);
  const errorId = fieldErrorId("home-care-reason");

  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor="home-care-reason">What&apos;s going on?</Label>
      <Textarea id="home-care-reason" name="reason" maxLength={500} required {...fieldErrorProps(errorId, Boolean(state?.error))} />
      <FormError id={errorId} message={state?.error} />
      <FormSuccess message={state?.success && "Sent. Your care coordinator will follow up."} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Request a home visit"}
      </Button>
    </form>
  );
}
