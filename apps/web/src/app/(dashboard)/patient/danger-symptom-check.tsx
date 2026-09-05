"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { reportDangerSymptoms, reportPaediatricDangerSymptoms } from "./actions";
import { DANGER_SIGNS, DANGER_SIGN_LABEL, type DangerSign } from "@/lib/validation/emergency";
import {
  PAEDIATRIC_DANGER_SIGNS,
  PAEDIATRIC_DANGER_SIGN_LABEL,
  type PaediatricDangerSign,
} from "@/lib/validation/pediatric-emergency";
import { shouldOfferPaediatricSymptomTypes } from "@/lib/rules/pediatric-symptom-triage";
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
 *
 * §48.9: "Paediatric triage must not simply reuse adult rules". When the open
 * account belongs to a dependent under 5 (ageYears, from the subject's own
 * date_of_birth — see dashboard-context.ts's subjectDateOfBirth), this shows
 * the paediatric sign list (lib/validation/pediatric-emergency.ts) instead of
 * the adult one — same emergency_events pathway either way, just a different,
 * age-appropriate question set. Both useActionState hooks are always called
 * (hooks can't be conditional); only the matching form/action pair renders.
 */
export function DangerSymptomCheck({ patientId, ageYears = null }: { patientId: string; ageYears?: number | null }) {
  const isPaediatric = shouldOfferPaediatricSymptomTypes(ageYears);
  const [selected, setSelected] = useState<Set<DangerSign>>(new Set());
  const [paediatricSelected, setPaediatricSelected] = useState<Set<PaediatricDangerSign>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState(reportDangerSymptoms, undefined);
  const [paediatricState, paediatricFormAction, paediatricPending] = useActionState(
    reportPaediatricDangerSymptoms,
    undefined
  );
  const activeState = isPaediatric ? paediatricState : state;
  const activePending = isPaediatric ? paediatricPending : pending;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (activeState?.success) {
      // Surface the EmergencyAlert dialog immediately (it takes over the screen,
      // so the chip selection behind it doesn't need clearing here).
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
  }, [activeState?.success, queryClient, patientId]);

  function toggle(sign: DangerSign) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  function togglePaediatric(sign: PaediatricDangerSign) {
    setPaediatricSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  return (
    <Card className="border-red-200 dark:border-red-500/30">
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
        <span className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
          <TriangleAlert className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden />
          Feeling something serious right now?
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300">
          {expanded ? "Hide" : "Get emergency guidance"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            strokeWidth={2} aria-hidden />
        </span>
      </button>

      {expanded && (
        <CardContent className="pt-0">
          <p className="mb-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Tap anything you&apos;re experiencing. If it&apos;s a medical emergency, we&apos;ll tell
            you what to do; TarragonHealth does not provide emergency care, so you should go to
            your nearest hospital.
          </p>
          <form action={isPaediatric ? paediatricFormAction : formAction} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {isPaediatric
                ? PAEDIATRIC_DANGER_SIGNS.map((sign) => {
                    const isOn = paediatricSelected.has(sign);
                    return (
                      <button
                        key={sign}
                        type="button"
                        onClick={() => togglePaediatric(sign)}
                        aria-pressed={isOn}
                        className={cn(
                          "min-h-11 rounded-full border px-4 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                          isOn
                            ? "border-red-600 bg-red-600 text-white"
                            : "border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card text-charcoal-ink dark:text-night-ink hover:border-red-400"
                        )}
                      >
                        {PAEDIATRIC_DANGER_SIGN_LABEL[sign]}
                      </button>
                    );
                  })
                : DANGER_SIGNS.map((sign) => {
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
                            : "border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card text-charcoal-ink dark:text-night-ink hover:border-red-400"
                        )}
                      >
                        {DANGER_SIGN_LABEL[sign]}
                      </button>
                    );
                  })}
            </div>

            {isPaediatric
              ? [...paediatricSelected].map((sign) => <input key={sign} type="hidden" name="signs" value={sign} />)
              : [...selected].map((sign) => <input key={sign} type="hidden" name="signs" value={sign} />)}

            {activeState?.error && <p className="text-sm text-red-600 dark:text-red-300">{activeState.error}</p>}

            <Button
              type="submit"
              disabled={
                activePending || (isPaediatric ? paediatricSelected.size === 0 : selected.size === 0)
              }
              className="bg-red-600 hover:bg-red-700"
            >
              {activePending ? "Getting help…" : "Get emergency guidance"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
