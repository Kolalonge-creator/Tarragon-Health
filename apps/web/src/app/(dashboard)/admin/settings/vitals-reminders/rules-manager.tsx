"use client";

import { useState } from "react";
import {
  useVitalsReminderRules,
  useUpsertVitalsReminderRule,
  useDeleteVitalsReminderRule,
} from "@/lib/queries/vitals-reminder-rules";
import { vitalsReminderRuleSchema } from "@/lib/validation/vitals-reminder-rules";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONDITIONS = ["hypertension", "diabetes"] as const;
type Condition = (typeof CONDITIONS)[number];

const CONDITION_LABEL: Record<Condition, string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
};

/** Mirrors private.queue_vitals_reminders()'s hardcoded fallback tier. */
const HARDCODED_DEFAULT_DAYS = { hypertension: 3, diabetes: 3, none: 30 } as const;

type RawRuleInput =
  | { scope: "global"; frequency_days: string }
  | { scope: "condition"; condition: Condition; frequency_days: string }
  | { scope: "patient"; patient_phone: string; frequency_days: string };

export function RulesManager() {
  const { data: rules, isLoading, isError } = useVitalsReminderRules();
  const upsert = useUpsertVitalsReminderRule();
  const del = useDeleteVitalsReminderRule();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [globalInput, setGlobalInput] = useState("");
  const [conditionInputs, setConditionInputs] = useState<Record<string, string>>({});
  const [patientPhoneInput, setPatientPhoneInput] = useState("");
  const [patientFreqInput, setPatientFreqInput] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !rules) {
    return <p className="text-sm text-red-600">Could not load reminder rules.</p>;
  }

  const globalRule = rules.find((r) => r.patient_id === null && r.condition === null) ?? null;
  const conditionRules = new Map(
    rules
      .filter((r) => r.patient_id === null && r.condition !== null)
      .map((r) => [r.condition as Condition, r])
  );
  const patientRules = rules.filter((r) => r.patient_id !== null);

  const mutationError =
    (upsert.error as Error | null)?.message ?? (del.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function submit(input: RawRuleInput) {
    const parsed = vitalsReminderRuleSchema.safeParse(input);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    upsert.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      {displayError && <p className="text-sm text-red-600">{displayError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Global default</CardTitle>
          <CardDescription>
            Applies to any patient with no condition-specific or patient-specific override.
            {!globalRule &&
              ` Currently falling back to the hardcoded default (${HARDCODED_DEFAULT_DAYS.none} days).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="global-frequency">Every</Label>
            <Input
              id="global-frequency"
              type="number"
              min={1}
              max={90}
              placeholder={String(globalRule?.frequency_days ?? HARDCODED_DEFAULT_DAYS.none)}
              value={globalInput}
              onChange={(e) => setGlobalInput(e.target.value)}
              className="w-24"
            />
          </div>
          <span className="pb-2 text-sm text-charcoal-ink/60">days</span>
          <Button
            size="sm"
            disabled={upsert.isPending || !globalInput}
            onClick={() => {
              submit({ scope: "global", frequency_days: globalInput });
              setGlobalInput("");
            }}
          >
            Save
          </Button>
          {globalRule && (
            <Button
              size="sm"
              variant="outline"
              disabled={del.isPending}
              onClick={() => del.mutate(globalRule.id)}
            >
              Reset to default
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Condition cadence</CardTitle>
          <CardDescription>
            Overrides the global default for patients with an active care plan for this
            condition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CONDITIONS.map((condition) => {
            const rule = conditionRules.get(condition) ?? null;
            const inputValue = conditionInputs[condition] ?? "";
            return (
              <div
                key={condition}
                className="flex items-end gap-3 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
              >
                <div className="w-32 text-sm font-medium text-charcoal-ink">
                  {CONDITION_LABEL[condition]}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`condition-${condition}`}>Every</Label>
                  <Input
                    id={`condition-${condition}`}
                    type="number"
                    min={1}
                    max={90}
                    placeholder={String(rule?.frequency_days ?? HARDCODED_DEFAULT_DAYS[condition])}
                    value={inputValue}
                    onChange={(e) =>
                      setConditionInputs((prev) => ({ ...prev, [condition]: e.target.value }))
                    }
                    className="w-24"
                  />
                </div>
                <span className="pb-2 text-sm text-charcoal-ink/60">days</span>
                <Button
                  size="sm"
                  disabled={upsert.isPending || !inputValue}
                  onClick={() => {
                    submit({ scope: "condition", condition, frequency_days: inputValue });
                    setConditionInputs((prev) => ({ ...prev, [condition]: "" }));
                  }}
                >
                  Save
                </Button>
                {rule && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={del.isPending}
                    onClick={() => del.mutate(rule.id)}
                  >
                    Reset to default
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Patient-specific overrides</CardTitle>
          <CardDescription>
            Highest priority — beats both the condition and global cadence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="patient-phone">Patient phone</Label>
              <Input
                id="patient-phone"
                placeholder="+234XXXXXXXXXX"
                value={patientPhoneInput}
                onChange={(e) => setPatientPhoneInput(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="patient-frequency">Every</Label>
              <Input
                id="patient-frequency"
                type="number"
                min={1}
                max={90}
                value={patientFreqInput}
                onChange={(e) => setPatientFreqInput(e.target.value)}
                className="w-24"
              />
            </div>
            <span className="pb-2 text-sm text-charcoal-ink/60">days</span>
            <Button
              size="sm"
              disabled={upsert.isPending || !patientPhoneInput || !patientFreqInput}
              onClick={() => {
                submit({
                  scope: "patient",
                  patient_phone: patientPhoneInput,
                  frequency_days: patientFreqInput,
                });
                setPatientPhoneInput("");
                setPatientFreqInput("");
              }}
            >
              Add
            </Button>
          </div>

          {patientRules.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No patient-specific overrides.</p>
          )}
          {patientRules.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {patientRules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {rule.patient?.full_name ?? "Unknown patient"}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {rule.patient?.phone} — every {rule.frequency_days} days
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={del.isPending}
                    onClick={() => del.mutate(rule.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
