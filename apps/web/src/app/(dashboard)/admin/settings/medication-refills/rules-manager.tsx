"use client";

import { useState } from "react";
import {
  useMedicationRefillRules,
  useUpsertMedicationRefillRule,
  useDeleteMedicationRefillRule,
} from "@/lib/queries/medication-refill-rules";
import { medicationRefillRuleSchema } from "@/lib/validation/medication-refill-rules";
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

/** Mirrors private.queue_medication_refill_reminders()'s hardcoded fallback tier. */
const HARDCODED_DEFAULT_LEAD_DAYS = 7;

type RawRuleInput =
  | { scope: "global"; lead_days: string }
  | { scope: "patient"; patient_phone: string; lead_days: string };

export function RulesManager() {
  const { data: rules, isLoading, isError } = useMedicationRefillRules();
  const upsert = useUpsertMedicationRefillRule();
  const del = useDeleteMedicationRefillRule();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [globalInput, setGlobalInput] = useState("");
  const [patientPhoneInput, setPatientPhoneInput] = useState("");
  const [patientLeadInput, setPatientLeadInput] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !rules) {
    return <p className="text-sm text-red-600">Could not load refill rules.</p>;
  }

  const globalRule = rules.find((r) => r.patient_id === null) ?? null;
  const patientRules = rules.filter((r) => r.patient_id !== null);

  const mutationError =
    (upsert.error as Error | null)?.message ?? (del.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function submit(input: RawRuleInput) {
    const parsed = medicationRefillRuleSchema.safeParse(input);
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
            How many days before a medication&apos;s refill date to remind a patient, for
            anyone without a patient-specific override.
            {!globalRule &&
              ` Currently falling back to the hardcoded default (${HARDCODED_DEFAULT_LEAD_DAYS} days).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="global-lead-days">Remind</Label>
            <Input
              id="global-lead-days"
              type="number"
              min={1}
              max={30}
              placeholder={String(globalRule?.lead_days ?? HARDCODED_DEFAULT_LEAD_DAYS)}
              value={globalInput}
              onChange={(event) => setGlobalInput(event.target.value)}
              className="w-24"
            />
          </div>
          <span className="pb-2 text-sm text-charcoal-ink/60">days before refill</span>
          <Button
            size="sm"
            disabled={upsert.isPending || !globalInput}
            onClick={() => {
              submit({ scope: "global", lead_days: globalInput });
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
          <CardTitle>Patient-specific overrides</CardTitle>
          <CardDescription>Highest priority — beats the global lead time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="patient-phone">Patient phone</Label>
              <Input
                id="patient-phone"
                placeholder="+234XXXXXXXXXX"
                value={patientPhoneInput}
                onChange={(event) => setPatientPhoneInput(event.target.value)}
                className="w-48"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="patient-lead-days">Remind</Label>
              <Input
                id="patient-lead-days"
                type="number"
                min={1}
                max={30}
                value={patientLeadInput}
                onChange={(event) => setPatientLeadInput(event.target.value)}
                className="w-24"
              />
            </div>
            <span className="pb-2 text-sm text-charcoal-ink/60">days before refill</span>
            <Button
              size="sm"
              disabled={upsert.isPending || !patientPhoneInput || !patientLeadInput}
              onClick={() => {
                submit({
                  scope: "patient",
                  patient_phone: patientPhoneInput,
                  lead_days: patientLeadInput,
                });
                setPatientPhoneInput("");
                setPatientLeadInput("");
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
                      {rule.patient?.phone} — remind {rule.lead_days} days before refill
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
