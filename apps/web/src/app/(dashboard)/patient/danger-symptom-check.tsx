"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
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
import { Sheet } from "@/components/ui/sheet";
import { FormError, fieldErrorId } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";

/**
 * One-touch danger-symptom check. Tapping any sign records an emergency event,
 * which triages to the care team and immediately shows the patient the
 * "go to the nearest hospital now" alert. TarragonHealth does not provide
 * emergency care — this routes the patient to a hospital, it never manages the
 * emergency itself.
 *
 * Renders on every dashboard section (see (sections)/layout.tsx) as one
 * floating button that opens the checklist in a sheet. It used to be a red
 * card at the top of every page (about 85px collapsed), which pushed the real
 * content down on 15+ pages; now it takes no page space and stays reachable
 * while scrolling (design audit P1 item 11). Wording is the signed text.
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
  const errorId = fieldErrorId("danger-symptom-check");

  useEffect(() => {
    if (activeState?.success) {
      // Surface the EmergencyAlert dialog immediately (it takes over the screen).
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
  }, [activeState?.success, queryClient, patientId]);

  // Once a report is recorded, close the sheet and clear the selection so it cannot be sent twice when the
  // EmergencyAlert is dismissed. Adjusting state during render (not in an effect) keyed on the result object,
  // which is new for every submission.
  const [handledResult, setHandledResult] = useState<unknown>(undefined);
  if (activeState?.success && handledResult !== activeState) {
    setHandledResult(activeState);
    setExpanded(false);
    setSelected(new Set());
    setPaediatricSelected(new Set());
  }

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
    <>
      {/* One persistent control instead of a red card at the top of every page.
          It sits above the phone bottom tab bar (z-40, ~64px) and bottom-right on wide screens. */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 lg:bottom-6 lg:right-6 print:hidden"
      >
        <TriangleAlert className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden />
        Get emergency guidance
      </button>

      <Sheet
        open={expanded}
        onClose={() => setExpanded(false)}
        tone="danger"
        layerClassName="z-[45]"
        title="Feeling something serious right now?"
        titleIcon={<TriangleAlert className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden />}
      >
        <div>
          <p className="mb-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Tap anything you&apos;re experiencing. If it&apos;s a medical emergency, we&apos;ll tell
            you what to do; TarragonHealth does not provide emergency care, so you should go to
            your nearest hospital.
          </p>
          <form action={isPaediatric ? paediatricFormAction : formAction} className="space-y-4">
            <div
              role="group"
              aria-label="Danger signs you are experiencing"
              aria-describedby={activeState?.error ? errorId : undefined}
              className="flex flex-wrap gap-2"
            >
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

            <FormError id={errorId} message={activeState?.error} />

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
        </div>
      </Sheet>
    </>
  );
}
