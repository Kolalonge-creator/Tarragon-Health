"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { setItemActive, setItemPrice, type CatalogueActionState } from "./actions";

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
