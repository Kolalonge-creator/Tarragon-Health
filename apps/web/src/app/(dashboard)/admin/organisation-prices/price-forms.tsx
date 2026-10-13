"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { clearOrganisationPrice, setOrganisationPrice, type OrganisationPriceActionState } from "./actions";

/** Set a price: for one organisation, or (no organisationId) the default. */
export function SetPriceForm({ organisationId, idPrefix }: { organisationId: string | null; idPrefix: string }) {
  const [state, action, pending] = useActionState<OrganisationPriceActionState, FormData>(setOrganisationPrice, undefined);
  return (
    <form action={action} className="space-y-2">
      {organisationId ? <input type="hidden" name="organisation_id" value={organisationId} /> : null}
      <Label htmlFor={`${idPrefix}-naira`}>New price (naira per member per year)</Label>
      <Input id={`${idPrefix}-naira`} name="naira" inputMode="numeric" required pattern="\d{1,9}" />
      <Label htmlFor={`${idPrefix}-start`}>Starts on (leave empty to start now)</Label>
      <Input id={`${idPrefix}-start`} name="starts_on" type="date" />
      <Label htmlFor={`${idPrefix}-reason`}>Reason</Label>
      <Input id={`${idPrefix}-reason`} name="reason" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">Save price</Button>
      <FormError id={`${idPrefix}-err`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}

export function ClearPriceForm({ organisationId, idPrefix }: { organisationId: string; idPrefix: string }) {
  const [state, action, pending] = useActionState<OrganisationPriceActionState, FormData>(clearOrganisationPrice, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organisation_id" value={organisationId} />
      <Label htmlFor={`${idPrefix}-clear-reason`}>Reason for going back to the default</Label>
      <Input id={`${idPrefix}-clear-reason`} name="reason" required minLength={10} maxLength={500} />
      <Button type="submit" variant="outline" disabled={pending} className="min-h-11">Go back to the default price</Button>
      <FormError id={`${idPrefix}-clear-err`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}
