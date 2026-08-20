"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NAV_ICON } from "@/lib/icons";
import { reportDangerSymptoms } from "./actions";
import { DANGER_SIGNS, DANGER_SIGN_LABEL, type DangerSign } from "@/lib/validation/emergency";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One-touch danger-symptom check. Tapping any sign records an emergency event,
 * which triages to the care team and immediately shows the patient the
 * "go to the nearest hospital now" alert. TarragonHealth does not provide
 * emergency care — this routes the patient to a hospital, it never manages the
 * emergency itself.
 *
 * Renders on every dashboard section (see (sections)/layout.tsx), so it stays
 * collapsed to a single row by default and expands in place — the full
 * checklist was adding a fixed ~200px of red card above every page's actual
 * content regardless of whether anyone needed it.
 */
export function DangerSymptomCheck({ patientId }: { patientId: string }) {
  const [selected, setSelected] = useState<Set<DangerSign>>(new Set());
  const [expanded, setExpanded] = useState(false);
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
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        // Stacks on phones. Side by side, the question and the "Get emergency
        // guidance" control each fought for a 375px row and the question broke
        // across four one-word lines — the worst possible legibility for the
        // one surface on the page that someone unwell needs to read fast.
        className="flex w-full flex-col items-start gap-1.5 px-5 py-3.5 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <NAV_ICON.warning className="h-4.5 w-4.5 shrink-0" strokeWidth={2} />
          Feeling something serious right now?
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-red-700">
          {expanded ? "Hide" : "Get emergency guidance"}
          <NAV_ICON.chevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            strokeWidth={2}
          />
        </span>
      </button>

      {expanded && (
        <CardContent className="pt-0">
          <p className="mb-4 text-sm text-charcoal-ink/70">
            Tap anything you&apos;re experiencing. If it&apos;s a medical emergency, we&apos;ll tell
            you what to do; TarragonHealth does not provide emergency care, so you should go to
            your nearest hospital.
          </p>
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
                      "min-h-11 rounded-full border px-4 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
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
      )}
    </Card>
  );
}
