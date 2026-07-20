"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCvRiskConfigDraftAction, type SaveCvRiskConfigState } from "./actions";
import type { CvRiskConfigFormValues } from "@/lib/validation/cv-risk-config";

type NumField = { name: keyof CvRiskConfigFormValues; label: string; unit?: string };

const TARGET_FIELDS: NumField[] = [
  { name: "secondary_ldl_max", label: "Secondary — LDL max", unit: "mg/dL" },
  { name: "secondary_non_hdl_max", label: "Secondary — Non-HDL max", unit: "mg/dL" },
  { name: "primary_high_ldl_max", label: "Primary (high risk) — LDL max", unit: "mg/dL" },
  { name: "primary_high_non_hdl_max", label: "Primary (high risk) — Non-HDL max", unit: "mg/dL" },
  { name: "primary_standard_ldl_max", label: "Primary (standard) — LDL max", unit: "mg/dL" },
  { name: "primary_standard_non_hdl_max", label: "Primary (standard) — Non-HDL max", unit: "mg/dL" },
];

const RULE_FIELDS: NumField[] = [
  { name: "diabetes_min_age", label: "Diabetes statin indication — min age", unit: "yrs" },
  { name: "primary_10yr_risk_pct", label: "Primary statin discussion — 10-yr risk", unit: "%" },
];

const ESCALATION_FIELDS: NumField[] = [
  { name: "very_high_ldl", label: "Escalate — very high LDL", unit: "mg/dL" },
  { name: "very_high_non_hdl", label: "Escalate — very high Non-HDL", unit: "mg/dL" },
  { name: "worsening_trend_pct", label: "Escalate — worsening trend rise", unit: "%" },
  { name: "chronic_lipid_monitoring_months", label: "Chronic lipid recheck cadence", unit: "mo" },
];

function NumberFields({
  fields,
  defaults,
}: {
  fields: NumField[];
  defaults: CvRiskConfigFormValues;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={f.name}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
          </Label>
          <Input
            id={f.name}
            name={f.name}
            type="number"
            step="any"
            defaultValue={String(defaults[f.name])}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Edit the CV-risk thresholds/targets and save them as a NEW version. Prefilled
 * from the current values. Saving creates an unsigned draft — a Clinical
 * Director then signs it below to bring it into force. Existing signed versions
 * are never mutated.
 */
export function CvRiskConfigEditor({ defaults }: { defaults: CvRiskConfigFormValues }) {
  const [state, action, pending] = useActionState<SaveCvRiskConfigState, FormData>(
    createCvRiskConfigDraftAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit values — create a new version</CardTitle>
        <CardDescription>
          Adjust any threshold or target below and save. This creates a new unsigned draft version
          (it does not change what is currently in force). Review it in the list below, then sign to
          bring it into force. All values are in mg/dL unless noted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">LDL / Non-HDL targets by category</p>
            <NumberFields fields={TARGET_FIELDS} defaults={defaults} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">Statin eligibility</p>
            <NumberFields fields={RULE_FIELDS} defaults={defaults} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">Escalation &amp; monitoring</p>
            <NumberFields fields={ESCALATION_FIELDS} defaults={defaults} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="population_note">Population / methodology note (shown to clinicians)</Label>
            <Textarea
              id="population_note"
              name="population_note"
              rows={3}
              defaultValue={defaults.population_note}
            />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">
              New draft version created — review it below and sign to bring it into force.
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save as new version"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
