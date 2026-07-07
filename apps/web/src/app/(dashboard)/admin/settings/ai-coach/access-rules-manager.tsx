"use client";

import { useState } from "react";
import {
  useAiCoachAccessRules,
  useUpsertAiCoachAccessRule,
  useDeleteAiCoachAccessRule,
} from "@/lib/queries/ai-coach-access-rules";
import { aiCoachAccessRuleSchema } from "@/lib/validation/ai-coach-access-rules";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RawRuleInput =
  | { scope: "global"; enabled?: boolean; daily_limit?: string }
  | { scope: "patient"; patient_phone: string; enabled?: boolean; daily_limit?: string };

export function AccessRulesManager() {
  const { data: rules, isLoading, isError } = useAiCoachAccessRules();
  const upsert = useUpsertAiCoachAccessRule();
  const del = useDeleteAiCoachAccessRule();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [patientPhoneInput, setPatientPhoneInput] = useState("");
  const [patientCapInput, setPatientCapInput] = useState("");
  const [globalCapInput, setGlobalCapInput] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !rules) {
    return <p className="text-sm text-red-600">Could not load access rules.</p>;
  }

  const globalRule = rules.find((r) => r.patient_id === null) ?? null;
  const patientRules = rules.filter((r) => r.patient_id !== null);

  const mutationError =
    (upsert.error as Error | null)?.message ?? (del.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function submit(input: RawRuleInput) {
    const parsed = aiCoachAccessRuleSchema.safeParse(input);
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
          <CardTitle>Everyone</CardTitle>
          <CardDescription>
            {globalRule
              ? globalRule.enabled
                ? "The coach is currently available to every patient."
                : "The coach is currently disabled for every patient (overrides any subscription plan feature)."
              : "No org-wide override set — access falls back to each patient's subscription plan and any patient-specific grant below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button
              size="sm"
              disabled={upsert.isPending || globalRule?.enabled === true}
              onClick={() => submit({ scope: "global", enabled: true })}
            >
              Enable for everyone
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={upsert.isPending || globalRule?.enabled === false}
              onClick={() => submit({ scope: "global", enabled: false })}
            >
              Disable for everyone
            </Button>
            {globalRule && (
              <Button
                size="sm"
                variant="outline"
                disabled={del.isPending}
                onClick={() => del.mutate(globalRule.id)}
              >
                Clear override
              </Button>
            )}
          </div>

          <div className="flex items-end gap-3 border-t border-charcoal-ink/10 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="ai-coach-global-cap">Org-wide daily message cap</Label>
              <Input
                id="ai-coach-global-cap"
                type="number"
                min={1}
                max={500}
                placeholder={globalRule?.daily_limit ? String(globalRule.daily_limit) : "no override"}
                value={globalCapInput}
                onChange={(e) => setGlobalCapInput(e.target.value)}
                className="w-32"
              />
            </div>
            <span className="pb-2 text-sm text-charcoal-ink/60">messages/day</span>
            <Button
              size="sm"
              disabled={upsert.isPending || !globalCapInput}
              onClick={() => {
                submit({ scope: "global", daily_limit: globalCapInput });
                setGlobalCapInput("");
              }}
            >
              Set cap
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Patient-specific access</CardTitle>
          <CardDescription>
            Grant/revoke access or override the daily message cap for one patient — beats both
            the org-wide setting above and their subscription plan&apos;s cap.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-coach-patient-phone">Patient phone</Label>
              <Input
                id="ai-coach-patient-phone"
                placeholder="+234XXXXXXXXXX"
                value={patientPhoneInput}
                onChange={(e) => setPatientPhoneInput(e.target.value)}
                className="w-48"
              />
            </div>
            <Button
              size="sm"
              disabled={upsert.isPending || !patientPhoneInput}
              onClick={() => {
                submit({ scope: "patient", patient_phone: patientPhoneInput, enabled: true });
                setPatientPhoneInput("");
              }}
            >
              Grant access
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={upsert.isPending || !patientPhoneInput}
              onClick={() => {
                submit({ scope: "patient", patient_phone: patientPhoneInput, enabled: false });
                setPatientPhoneInput("");
              }}
            >
              Revoke access
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="ai-coach-patient-cap">Daily cap override</Label>
              <Input
                id="ai-coach-patient-cap"
                type="number"
                min={1}
                max={500}
                value={patientCapInput}
                onChange={(e) => setPatientCapInput(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={upsert.isPending || !patientPhoneInput || !patientCapInput}
              onClick={() => {
                submit({
                  scope: "patient",
                  patient_phone: patientPhoneInput,
                  daily_limit: patientCapInput,
                });
                setPatientCapInput("");
              }}
            >
              Set cap
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
                      {rule.patient?.phone} — {rule.enabled ? "granted" : "revoked"}
                      {rule.daily_limit ? ` — ${rule.daily_limit} messages/day` : ""}
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
