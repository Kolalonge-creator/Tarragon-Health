"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { submitConfigRequestAction, type ConfigState } from "./actions";

type Props = {
  pathways: string[];
  items: { code: string; kind: string }[];
  campaigns: { id: string; name: string; status: string }[];
  maxBudgetNaira: number;
};

export function ConfigForm({ pathways, items, campaigns, maxBudgetNaira }: Props) {
  const [state, action, pending] = useActionState<ConfigState, FormData>(submitConfigRequestAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="font-medium">Care pathways</legend>
        {pathways.map((p) => (
          <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="pathways" value={p} /> {p.replace(/_/g, " ")}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-medium">Services you would pay for</legend>
        {items.map((i) => (
          <label key={i.code} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="items" value={i.code} /> {i.code.replace(/_/g, " ")} <span className="text-charcoal-ink/50">({i.kind})</span>
          </label>
        ))}
      </fieldset>
      {campaigns.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="font-medium">Challenges and campaigns to include</legend>
          {campaigns.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="campaigns" value={c.id} /> {c.name} <span className="text-charcoal-ink/50">({c.status})</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="block text-sm">
        <span className="font-medium">Rewards budget you would like to set aside (naira, up to {maxBudgetNaira.toLocaleString("en-NG")})</span>
        <input name="budget_naira" type="number" min={0} max={maxBudgetNaira} step={1} defaultValue={0} className="mt-1 block min-h-11 w-full rounded border px-3" />
        <span className="text-xs text-charcoal-ink/60">This is a request, not a balance held for you. Tarragon will agree how rewards work with you before any money is committed. You never see who earned what.</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Anything we should know (optional)</span>
        <textarea name="note" maxLength={1000} rows={3} className="mt-1 block w-full rounded border px-3 py-2" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending" : "Send for Tarragon to review"}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="text-sm text-brand-green">
          Sent. Tarragon will review it and get back to you.
        </p>
      )}
    </form>
  );
}
