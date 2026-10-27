"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { setItemActive, setItemExtras, setItemPrice, type CatalogueActionState } from "./actions";

/** Which other items are listed as "not included, sold separately" on this item's pages. Words-only entries (such as medicines) are set in code. */
export function ExtrasForm({ code, options, chosen }: { code: string; options: readonly string[]; chosen: readonly string[] }) {
  const [state, action, pending] = useActionState<CatalogueActionState, FormData>(setItemExtras, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <fieldset className="space-y-1">
        <legend className="font-medium">Listed as not included (sold separately)</legend>
        {options.length === 0 ? <p>No other items to list.</p> : null}
        {options.map((o) => (
          <label key={o} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="extra" value={o} defaultChecked={chosen.includes(o)} className="h-5 w-5" />
            {o}
          </label>
        ))}
      </fieldset>
      <Label htmlFor={`reason-${code}-extras`}>Reason</Label>
      <Input id={`reason-${code}-extras`} name="reason" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">Save list</Button>
      <FormError id={`err-${code}-extras`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}

export function ActiveForm({ code, active }: { code: string; active: boolean }) {
  const [state, action, pending] = useActionState<CatalogueActionState, FormData>(setItemActive, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Label htmlFor={`reason-${code}-active`}>Reason</Label>
      <Input id={`reason-${code}-active`} name="reason" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">{active ? "Switch off" : "Switch on"}</Button>
      <FormError id={`err-${code}-active`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}

export function PriceForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState<CatalogueActionState, FormData>(setItemPrice, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <Label htmlFor={`naira-${code}`}>New price (naira)</Label>
      <Input id={`naira-${code}`} name="naira" inputMode="numeric" required pattern="\d{1,9}" />
      <Label htmlFor={`start-${code}`}>Starts on</Label>
      <Input id={`start-${code}`} name="starts_on" type="date" required />
      <Label htmlFor={`reason-${code}-price`}>Reason</Label>
      <Input id={`reason-${code}-price`} name="reason" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">Save price</Button>
      <FormError id={`err-${code}-price`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}
