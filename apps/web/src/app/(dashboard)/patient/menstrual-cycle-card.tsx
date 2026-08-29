"use client";

import { useActionState, useEffect, useState } from "react";
import { logMenstrualCycle } from "./womens-health-actions";
import { useMenstrualCycleLogs, useInvalidateWomensHealth } from "@/lib/queries/womens-health";
import {
  FLOW_LEVELS,
  MENSTRUAL_SYMPTOMS,
  MENSTRUAL_SYMPTOM_LABEL,
  type MenstrualSymptom,
} from "@/lib/validation/womens-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const FLOW_LABEL: Record<(typeof FLOW_LEVELS)[number], string> = {
  spotting: "Spotting",
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

/**
 * Menstrual cycle log (§44.3) — period dates, duration, flow, pain,
 * symptoms. A pattern across recent logs (repeated heavy flow, repeated
 * severe pain, or a materially changed cycle length) is picked up server-side
 * by the menstrual_cycle_logs_raise_pattern_alert trigger — this card never
 * decides urgency itself, it only records what the patient reports.
 */
export function MenstrualCycleCard({ patientId }: { patientId: string }) {
  const logs = useMenstrualCycleLogs(patientId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const [state, formAction, pending] = useActionState(logMenstrualCycle, undefined);
  const [symptoms, setSymptoms] = useState<Set<MenstrualSymptom>>(new Set());

  useEffect(() => {
    if (state?.success) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  function toggleSymptom(symptom: MenstrualSymptom) {
    setSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(symptom)) next.delete(symptom);
      else next.add(symptom);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menstrual cycle</CardTitle>
        <CardDescription>
          Log your period dates, flow, pain and symptoms. This is a record for you and your care
          team — not a prediction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="period_start_date">Period start date</Label>
              <Input id="period_start_date" name="period_start_date" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period_end_date">Period end date (if known)</Label>
              <Input id="period_end_date" name="period_end_date" type="date" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="flow_level">Flow</Label>
              <Select id="flow_level" name="flow_level" defaultValue="">
                <option value="">Not sure / prefer not to say</option>
                {FLOW_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {FLOW_LABEL[level]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pain_level">Pain (0–10)</Label>
              <Input id="pain_level" name="pain_level" type="number" min={0} max={10} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Symptoms</Label>
            <div className="flex flex-wrap gap-2">
              {MENSTRUAL_SYMPTOMS.map((symptom) => {
                const isOn = symptoms.has(symptom);
                return (
                  <button
                    key={symptom}
                    type="button"
                    onClick={() => toggleSymptom(symptom)}
                    aria-pressed={isOn}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      isOn
                        ? "border-brand-green bg-brand-green text-white"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-brand-green/50"
                    )}
                  >
                    {MENSTRUAL_SYMPTOM_LABEL[symptom]}
                  </button>
                );
              })}
            </div>
            {[...symptoms].map((symptom) => (
              <input key={symptom} type="hidden" name="symptoms" value={symptom} />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" name="notes" placeholder="Anything else worth noting" />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Logged.</p>}

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Log period"}
          </Button>
        </form>

        {logs.data && logs.data.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Recent logs
            </p>
            <ul className="space-y-1.5">
              {logs.data.slice(0, 6).map((log) => (
                <li key={log.id} className="text-sm text-charcoal-ink/80">
                  {new Date(log.period_start_date).toLocaleDateString()}
                  {log.period_end_date ? ` – ${new Date(log.period_end_date).toLocaleDateString()}` : ""}
                  {log.flow_level ? ` · ${FLOW_LABEL[log.flow_level]} flow` : ""}
                  {log.pain_level != null ? ` · Pain ${log.pain_level}/10` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
