"use client";

import { useActionState } from "react";
import { saveGrowthConfig, type GrowthConfigState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { koboToNaira } from "@tarragon/shared";

export type GrowthConfigRow = {
  id: string;
  organisationId: string | null;
  organisationName: string | null;
  referralRewardKobo: number;
  referralApplyWindowDays: number;
  updatedAt: string;
};

function GrowthConfigForm({
  organisationId,
  referralRewardKobo,
  referralApplyWindowDays,
  submitLabel,
}: {
  organisationId: string | null;
  referralRewardKobo: number;
  referralApplyWindowDays: number;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<GrowthConfigState, FormData>(
    saveGrowthConfig,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organisation_id" value={organisationId ?? ""} />
      <div className="space-y-1">
        <Label className="text-xs">Referral reward (₦, each side)</Label>
        <Input
          type="number"
          name="reward_naira"
          step="1"
          min="0"
          max="100000"
          defaultValue={koboToNaira(referralRewardKobo)}
          className="h-8 w-32 text-xs"
          required
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Apply window (days)</Label>
        <Input
          type="number"
          name="window_days"
          step="1"
          min="1"
          max="365"
          defaultValue={referralApplyWindowDays}
          className="h-8 w-24 text-xs"
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}

function AddOverrideForm({ organisations }: { organisations: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<GrowthConfigState, FormData>(
    saveGrowthConfig,
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
        <Label className="text-xs">Referral reward (₦, each side)</Label>
        <Input
          type="number"
          name="reward_naira"
          step="1"
          min="0"
          max="100000"
          defaultValue={500}
          className="h-8 w-32 text-xs"
          required
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Apply window (days)</Label>
        <Input
          type="number"
          name="window_days"
          step="1"
          min="1"
          max="365"
          defaultValue={30}
          className="h-8 w-24 text-xs"
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add override"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}

/**
 * Platform-default row + one row per organisation override, same shape as
 * LabResultConsultPricingManager. public.redeem_referral_code reads the org
 * row first, falling back to the null-organisation default, so both the
 * reward and the apply window can be tuned here without a migration —
 * closing the gap 20260910011850_growth_config_and_credit_validity.sql's own
 * header describes ("tuning the platform's principal growth lever therefore
 * required a database migration, which in practice means it never gets
 * tuned").
 */
export function GrowthConfigManager({
  rows,
  organisations,
}: {
  rows: GrowthConfigRow[];
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
          <GrowthConfigForm
            organisationId={null}
            referralRewardKobo={defaultRow?.referralRewardKobo ?? 50000}
            referralApplyWindowDays={defaultRow?.referralApplyWindowDays ?? 30}
            submitLabel="Save default"
          />
          {defaultRow && (
            <p className="mt-2 text-xs text-charcoal-ink/50">
              Last saved {new Date(defaultRow.updatedAt).toLocaleString("en-GB")}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organisation overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrideRows.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No organisation-specific override yet.</p>
          )}
          <ul className="divide-y divide-charcoal-ink/10">
            {overrideRows.map((row) => (
              <li key={row.id} className="space-y-2 py-3">
                <p className="text-sm font-medium text-charcoal-ink">{row.organisationName}</p>
                <GrowthConfigForm
                  organisationId={row.organisationId}
                  referralRewardKobo={row.referralRewardKobo}
                  referralApplyWindowDays={row.referralApplyWindowDays}
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
