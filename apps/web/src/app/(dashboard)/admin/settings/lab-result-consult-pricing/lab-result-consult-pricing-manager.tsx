"use client";

import { useActionState } from "react";
import { saveLabResultConsultPrice, type LabResultConsultPricingState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { koboToNaira } from "@tarragon/shared";

export type PriceRow = {
  id: string;
  organisationId: string | null;
  organisationName: string | null;
  amountMinor: number;
  currency: string;
  isEnabled: boolean;
  updatedAt: string;
};

function PriceForm({
  organisationId,
  amountMinor,
  currency,
  isEnabled,
  submitLabel,
}: {
  organisationId: string | null;
  amountMinor: number;
  currency: string;
  isEnabled: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<LabResultConsultPricingState, FormData>(
    saveLabResultConsultPrice,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organisation_id" value={organisationId ?? ""} />
      <div className="space-y-1">
        <Label className="text-xs">Amount (₦)</Label>
        <Input
          type="number"
          name="amount_naira"
          step="1"
          min="1"
          defaultValue={koboToNaira(amountMinor)}
          className="h-8 w-28 text-xs"
          required
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Currency</Label>
        <Select name="currency" defaultValue={currency} className="h-8 w-20 text-xs">
          <option value="NGN">NGN</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
        </Select>
      </div>
      <label className="flex items-center gap-1.5 pb-1.5 text-xs text-charcoal-ink">
        <input type="checkbox" name="is_enabled" defaultChecked={isEnabled} className="h-4 w-4" />
        Enabled
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}

/**
 * Default row + one row per organisation override, each independently
 * editable; a fresh "add an override" form re-uses the same PriceForm with
 * organisationId unset (the action upserts by organisation_id, so saving a
 * new org there creates the override row).
 */
export function LabResultConsultPricingManager({
  rows,
  organisations,
}: {
  rows: PriceRow[];
  organisations: { id: string; name: string }[];
}) {
  const defaultRow = rows.find((r) => r.organisationId === null);
  const overrideRows = rows.filter((r) => r.organisationId !== null);
  const overriddenOrgIds = new Set(overrideRows.map((r) => r.organisationId));
  const availableOrgs = organisations.filter((o) => !overriddenOrgIds.has(o.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Platform default</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceForm
            organisationId={null}
            amountMinor={defaultRow?.amountMinor ?? 1_000_000}
            currency={defaultRow?.currency ?? "NGN"}
            isEnabled={defaultRow?.isEnabled ?? true}
            submitLabel="Save default"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organisation overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrideRows.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No organisation-specific price yet.</p>
          )}
          <ul className="divide-y divide-charcoal-ink/10">
            {overrideRows.map((row) => (
              <li key={row.id} className="space-y-2 py-3">
                <p className="text-sm font-medium text-charcoal-ink">{row.organisationName}</p>
                <PriceForm
                  organisationId={row.organisationId}
                  amountMinor={row.amountMinor}
                  currency={row.currency}
                  isEnabled={row.isEnabled}
                  submitLabel="Save override"
                />
              </li>
            ))}
          </ul>

          {availableOrgs.length > 0 && (
            <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
              <p className="text-xs font-medium text-charcoal-ink/70">Add an override</p>
              <AddOverrideForm organisations={availableOrgs} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AddOverrideForm({ organisations }: { organisations: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<LabResultConsultPricingState, FormData>(
    saveLabResultConsultPrice,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Organisation</Label>
        <Select name="organisation_id" className="h-8 w-48 text-xs" required>
          <option value="">Pick one…</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Amount (₦)</Label>
        <Input type="number" name="amount_naira" step="1" min="1" defaultValue={10_000} className="h-8 w-28 text-xs" required />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Currency</Label>
        <Select name="currency" defaultValue="NGN" className="h-8 w-20 text-xs">
          <option value="NGN">NGN</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
        </Select>
      </div>
      <label className="flex items-center gap-1.5 pb-1.5 text-xs text-charcoal-ink">
        <input type="checkbox" name="is_enabled" defaultChecked className="h-4 w-4" />
        Enabled
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add override"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}
