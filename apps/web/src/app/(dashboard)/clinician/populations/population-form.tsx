"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CARE_PLAN_CONDITIONS,
  CARE_PLAN_CONDITION_LABEL,
  PREVENTION_CONDITIONS,
  PREVENTION_CONDITION_LABEL,
  RISK_LEVELS,
  RISK_LEVEL_LABEL,
  CARE_GAP_TYPES,
  CARE_GAP_TYPE_LABEL,
  CONTROL_STATUSES,
  CONTROL_STATUS_LABEL,
  ENGAGEMENT_BANDS,
  ENGAGEMENT_BAND_LABEL,
} from "@/lib/populations/schemas";
import { createPopulationAction, type SavePopulationState } from "./actions";

function CheckboxGroup({
  name,
  options,
  labels,
}: {
  name: string;
  options: readonly string[];
  labels: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((value) => (
        <label key={value} className="flex items-center gap-1.5 text-sm text-charcoal-ink/80">
          <input type="checkbox" name={name} value={value} className="h-4 w-4 rounded border-charcoal-ink/30" />
          {labels[value]}
        </label>
      ))}
    </div>
  );
}

/**
 * Builds a custom population_definitions row (spec §41.5) — every axis maps
 * 1:1 onto get_population_members()'s filters vocabulary (populations/
 * schemas.ts documents both sides). Leaving every checkbox group empty
 * matches everyone in the org, same as omitting the key entirely.
 */
export function PopulationForm() {
  const [state, action, pending] = useActionState<SavePopulationState, FormData>(
    createPopulationAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build a custom population</CardTitle>
        <CardDescription>
          Combine any of the filters below — the population is every patient in your organisation
          matching all of the axes you set. Membership is computed live every time you open it,
          never a stored list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Adults 40+, uncontrolled hypertension" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" name="description" maxLength={2000} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Clinical condition (chronic care plan)</Label>
            <CheckboxGroup name="conditions" options={CARE_PLAN_CONDITIONS} labels={CARE_PLAN_CONDITION_LABEL} />
          </div>

          <div className="space-y-1">
            <Label>Prevention / screening condition</Label>
            <CheckboxGroup
              name="prevention_conditions"
              options={PREVENTION_CONDITIONS}
              labels={PREVENTION_CONDITION_LABEL}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Latest risk tier</Label>
              <CheckboxGroup name="risk_levels" options={RISK_LEVELS} labels={RISK_LEVEL_LABEL} />
            </div>
            <div className="space-y-1">
              <Label>Control status</Label>
              <CheckboxGroup name="control_status" options={CONTROL_STATUSES} labels={CONTROL_STATUS_LABEL} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Open care gap</Label>
            <CheckboxGroup name="care_gap_types" options={CARE_GAP_TYPES} labels={CARE_GAP_TYPE_LABEL} />
          </div>

          <div className="space-y-1">
            <Label>Engagement</Label>
            <CheckboxGroup name="engagement" options={ENGAGEMENT_BANDS} labels={ENGAGEMENT_BAND_LABEL} />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="min_age">Min age</Label>
              <Input id="min_age" name="min_age" type="number" min={0} max={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="max_age">Max age</Label>
              <Input id="max_age" name="max_age" type="number" min={0} max={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sex">Sex</Label>
              <select
                id="sex"
                name="sex"
                className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm"
                defaultValue=""
              >
                <option value="">Any</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="states">State(s)</Label>
              <Input id="states" name="states" placeholder="Lagos, Abuja" />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-sm text-charcoal-ink/80">
            <input type="checkbox" name="pregnant_only" className="h-4 w-4 rounded border-charcoal-ink/30" />
            Currently pregnant only
          </label>

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Create population"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Created — find it above.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
