"use client";

import { useState } from "react";
import { selectDailySet, stepDownActive, validDifficulty, type MskStartExtras } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { MskDrawing } from "./msk-drawing";

/** Today in Lagos as yyyy-mm-dd. The step-down end date is a Lagos calendar day. */
function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * The day's exercises for a pain programme (S96): text steps plus a line drawing, a difficulty rating after each exercise, a lighter plan
 * while a step-down runs, and gentle-only or rest when the activity safety gate says so. Every rule it applies lives in @tarragon/shared
 * and is deterministic. Ratings are sent to the database as they are given; a week can be finished only after enough different days.
 */
export function MskDaySet({ enrolmentId, ordinal, extras }: { enrolmentId: string; ordinal: number; extras: MskStartExtras }) {
  const [rated, setRated] = useState<Record<string, number>>({});
  const [easier, setEasier] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [daysDone, setDaysDone] = useState(extras.daysDone);
  const stepDownRunning = stepDownActive(extras.stepDown, lagosToday());
  const set = selectDailySet(extras.exercises, { gate: extras.gate, stepDownRunning });

  async function rate(key: string, rating: number) {
    if (!validDifficulty(rating)) return;
    setError(null);
    try {
      const { data, error: rpcError } = await createClient().rpc("record_msk_exercise_rating", {
        p_enrolment: enrolmentId, p_ordinal: ordinal, p_exercise_key: key, p_rating: rating,
      });
      const o = !rpcError && typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      if (!o || o.status !== "ok") { setError(t("therapy.msk.rate_error")); return; }
      setRated((r) => ({ ...r, [key]: rating }));
      setEasier((e) => ({ ...e, [key]: o.offer_easier === true }));
      if (typeof o.days_done === "number") setDaysDone(o.days_done);
    } catch {
      setError(t("therapy.msk.rate_error"));
    }
  }

  return (
    <section aria-label={t("therapy.msk.today_title")} className="space-y-4">
      <h2 className="text-sm font-semibold">{t("therapy.msk.today_title")}</h2>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("therapy.msk.today_intro")}</p>
      {stepDownRunning && extras.stepDown && (
        <p role="status" className="rounded-md border border-amber-300 p-2 text-sm">{t("therapy.msk.step_down_banner", "en", { date: extras.stepDown.until })}</p>
      )}
      {!stepDownRunning && set.reason === "activity_gate" && set.exercises.length > 0 && (
        <p role="status" className="rounded-md border border-amber-300 p-2 text-sm">{t("therapy.msk.gate_gentle")}</p>
      )}
      {extras.gate.decision === "rest" && <p role="status" className="rounded-md border border-amber-300 p-2 text-sm">{t("therapy.msk.gate_rest")}</p>}
      <ol className="space-y-5">
        {set.exercises.map((ex) => (
          <li key={ex.key} className="space-y-2 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-3">
            <h3 className="text-sm font-semibold">{ex.name}</h3>
            <MskDrawing exerciseKey={ex.key} />
            <p className="text-sm"><span className="font-medium">{t("therapy.msk.how_much")}: </span>{ex.dose}</p>
            <div>
              <p className="text-xs font-medium">{t("therapy.msk.how_to")}</p>
              <ol className="ml-5 list-decimal space-y-1 text-sm">
                {ex.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
            <p className="text-sm"><span className="font-medium">{t("therapy.msk.easier")}: </span>{ex.easier}</p>
            <p className="text-sm"><span className="font-medium">{t("therapy.msk.harder")}: </span>{ex.harder}</p>
            <p className="text-sm"><span className="font-medium">{t("therapy.msk.stop_if")}: </span>{ex.stop_if}</p>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium">{t("therapy.msk.rate_prompt")}</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={rated[ex.key] === n ? "default" : "outline"}
                    aria-pressed={rated[ex.key] === n}
                    onClick={() => void rate(ex.key, n)}
                  >
                    {t(`therapy.msk.rate_${n}` as MessageKey)}
                  </Button>
                ))}
              </div>
              {rated[ex.key] !== undefined && <p role="status" className="text-xs">{t("therapy.msk.rate_saved")}</p>}
              {easier[ex.key] && <p role="status" className="text-sm font-medium">{t("therapy.msk.offer_easier")}</p>}
            </fieldset>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-sm" role="status">{t("therapy.msk.days_progress", "en", { done: daysDone, needed: extras.daysNeeded })}</p>
    </section>
  );
}
