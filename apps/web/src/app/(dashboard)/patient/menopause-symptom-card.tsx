"use client";

import { useActionState, useEffect, useState } from "react";
import { logMenopauseSymptoms } from "./womens-health-actions";
import { useMenopauseSymptomLogs, useInvalidateWomensHealth } from "@/lib/queries/womens-health";
import {
  MENOPAUSE_SYMPTOM_TYPES,
  MENOPAUSE_SYMPTOM_LABEL,
  type MenopauseSymptomType,
} from "@/lib/validation/womens-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Menopause (§44.12): symptom tracking, informational only. Lifestyle
 * support and clinical consultation are
 * existing health_education content and the existing appointment engine —
 * no schema for those. Treatment monitoring (e.g. HRT) is the patient's
 * existing Medications list, not a parallel tracker here.
 *
 * postmenopausal_bleeding is the one field that always raises a clinical
 * clinician_review alert server-side — postmenopausal bleeding is a
 * standard red flag regardless of any other symptom reported.
 */
export function MenopauseSymptomCard({ patientId }: { patientId: string }) {
  const logs = useMenopauseSymptomLogs(patientId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const [state, formAction, pending] = useActionState(logMenopauseSymptoms, undefined);
  const [symptomTypes, setSymptomTypes] = useState<Set<MenopauseSymptomType>>(new Set());
  const [bleeding, setBleeding] = useState(false);

  useEffect(() => {
    if (state?.success) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  function toggle(type: MenopauseSymptomType) {
    setSymptomTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menopause</CardTitle>
        <CardDescription>Track symptoms so you and your care team can see patterns over time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Symptoms today</Label>
            <div className="flex flex-wrap gap-2">
              {MENOPAUSE_SYMPTOM_TYPES.map((type) => {
                const isOn = symptomTypes.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggle(type)}
                    aria-pressed={isOn}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      isOn
                        ? "border-brand-green bg-brand-green text-white"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-brand-green/50"
                    )}
                  >
                    {MENOPAUSE_SYMPTOM_LABEL[type]}
                  </button>
                );
              })}
            </div>
            {[...symptomTypes].map((type) => (
              <input key={type} type="hidden" name="symptom_types" value={type} />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="severity">Overall severity (0–10)</Label>
            <Input id="severity" name="severity" type="number" min={0} max={10} className="max-w-24" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="postmenopausal_bleeding"
              value="true"
              checked={bleeding}
              onChange={(e) => setBleeding(e.target.checked)}
            />
            I&apos;ve had bleeding since menopause
          </label>
          {bleeding && (
            <p className="text-xs text-amber-700">
              Any bleeding after menopause always needs assessment. Reporting this notifies your
              care team.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" name="notes" />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Logged.</p>}

          <Button type="submit" size="sm" disabled={pending || (symptomTypes.size === 0 && !bleeding)}>
            {pending ? "Saving…" : "Log symptoms"}
          </Button>
        </form>

        {logs.data && logs.data.length > 0 && (
          <div className="space-y-1.5 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Recent</p>
            {logs.data.slice(0, 5).map((log) => (
              <p key={log.id} className="text-sm text-charcoal-ink/80">
                {new Date(log.logged_at).toLocaleDateString()}:{" "}
                {log.symptom_types.map((t) => MENOPAUSE_SYMPTOM_LABEL[t]).join(", ") || "no symptoms"}
                {log.postmenopausal_bleeding ? " · bleeding reported" : ""}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
