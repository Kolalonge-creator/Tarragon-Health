"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { reportDangerSymptoms } from "./actions";
import { DANGER_SIGNS, DANGER_SIGN_LABEL, type DangerSign } from "@/lib/validation/emergency";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One-touch danger-symptom check. Tapping any sign records an emergency event,
 * which triages to the care team and immediately shows the patient the
 * "go to the nearest hospital now" alert. TarragonHealth does not provide
 * emergency care — this routes the patient to a hospital, it never manages the
 * emergency itself.
 */
export function DangerSymptomCheck({ patientId }: { patientId: string }) {
  const [selected, setSelected] = useState<Set<DangerSign>>(new Set());
  const [state, formAction, pending] = useActionState(reportDangerSymptoms, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      // Surface the EmergencyAlert dialog immediately (it takes over the screen,
      // so the chip selection behind it doesn't need clearing here).
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  function toggle(sign: DangerSign) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700">
          <TriangleAlert className="h-5 w-5" strokeWidth={2} />
          Feeling something serious right now?
        </CardTitle>
        <CardDescription>
          Tap anything you&apos;re experiencing. If it&apos;s a medical emergency, we&apos;ll tell
          you what to do — TarragonHealth does not provide emergency care, so you should go to your
          nearest hospital.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {DANGER_SIGNS.map((sign) => {
              const isOn = selected.has(sign);
              return (
                <button
                  key={sign}
                  type="button"
                  onClick={() => toggle(sign)}
                  aria-pressed={isOn}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                    isOn
                      ? "border-red-600 bg-red-600 text-white"
                      : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-red-400"
                  )}
                >
                  {DANGER_SIGN_LABEL[sign]}
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
    </Card>
  );
}
