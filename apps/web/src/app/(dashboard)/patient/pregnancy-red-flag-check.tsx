"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { reportPregnancyDangerSymptoms } from "./womens-health-actions";
import {
  PREGNANCY_DANGER_SIGNS,
  PREGNANCY_DANGER_SIGN_LABEL,
  type PregnancyDangerSign,
} from "@/lib/validation/womens-health";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Pregnancy red-flag safety pathway (§44.8) — a dedicated checklist alongside
 * (not instead of) the general one-touch emergency check
 * (danger-symptom-check.tsx), only shown while the patient is pregnant.
 * Reports the same way: an emergency_events row (source
 * 'pregnancy_symptom_checklist'), which the existing handle_emergency_event
 * trigger and EmergencyAlert dialog pick up unchanged — same acknowledge-
 * gated "go to the nearest hospital now" guidance, same emergency-contact
 * auto-notify, same follow-up-after-discharge check-in.
 */
export function PregnancyRedFlagCheck({ patientId }: { patientId: string }) {
  const [selected, setSelected] = useState<Set<PregnancyDangerSign>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState(reportPregnancyDangerSymptoms, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  function toggle(sign: PregnancyDangerSign) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  return (
    <Card className="border-red-200">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full flex-col items-start gap-1.5 px-5 py-3.5 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <TriangleAlert className="h-4.5 w-4.5 shrink-0" strokeWidth={2} />
          Any pregnancy warning signs?
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-red-700">
          {expanded ? "Hide" : "Check now"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            strokeWidth={2}
          />
        </span>
      </button>

      {expanded && (
        <CardContent className="pt-0">
          <p className="mb-4 text-sm text-charcoal-ink/70">
            Tap anything you&apos;re experiencing. These need urgent assessment during pregnancy —
            we&apos;ll tell you what to do; TarragonHealth does not provide emergency care, so you
            should go to your nearest hospital.
          </p>
          <form action={formAction} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PREGNANCY_DANGER_SIGNS.map((sign) => {
                const isOn = selected.has(sign);
                return (
                  <button
                    key={sign}
                    type="button"
                    onClick={() => toggle(sign)}
                    aria-pressed={isOn}
                    className={cn(
                      "min-h-11 rounded-full border px-4 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                      isOn
                        ? "border-red-600 bg-red-600 text-white"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-red-400"
                    )}
                  >
                    {PREGNANCY_DANGER_SIGN_LABEL[sign]}
                  </button>
                );
              })}
            </div>

            {[...selected].map((sign) => (
              <input key={sign} type="hidden" name="signs" value={sign} />
            ))}

            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

            <Button
              type="submit"
              disabled={pending || selected.size === 0}
              className="bg-red-600 hover:bg-red-700"
            >
              {pending ? "Getting help…" : "Get emergency guidance"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
