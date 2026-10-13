"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import {
  FREE_RED_CHECKIN_ANSWERS,
  useAnswerFreeRedCheckin,
  useFreeRedCheckin,
  type FreeRedCheckinAnswer,
} from "@/lib/queries/free-red-checkin";

/**
 * Two-tier (CMO 2026-10-08): a few hours after a red event on the Free plan we ask whether the patient got care. The answer
 * is kept for the patient only and is never routed to a doctor. The card never blocks anything else on the dashboard.
 */
export function FreeRedCheckin({ patientId }: { patientId: string }) {
  const { data } = useFreeRedCheckin(patientId);
  const answer = useAnswerFreeRedCheckin(patientId);
  const [done, setDone] = useState<FreeRedCheckinAnswer | null>(null);

  if (done) {
    return (
      <section aria-live="polite" className="rounded-lg border border-charcoal-ink/10 p-4 text-sm text-charcoal-ink dark:border-night-ink/15 dark:text-night-ink">
        <p>{t("freered.checkin.thanks", "en")}</p>
        {done === "not_yet" && <p className="mt-2 font-medium">{t("freered.checkin.not_yet_note", "en")}</p>}
      </section>
    );
  }
  if (!data) return null;

  return (
    <section aria-labelledby="free-red-checkin-title" className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4 text-sm text-charcoal-ink dark:border-night-ink/15 dark:text-night-ink">
      <h2 id="free-red-checkin-title" className="font-heading text-base font-semibold">
        {t("freered.checkin.title", "en")}
      </h2>
      <p>{t("freered.checkin.question", "en")}</p>
      <div className="flex flex-wrap gap-2">
        {FREE_RED_CHECKIN_ANSWERS.map((a) => (
          <Button
            key={a}
            type="button"
            variant="outline"
            disabled={answer.isPending}
            onClick={() => answer.mutate({ id: data.id, answer: a }, { onSuccess: () => setDone(a) })}
          >
            {t(`freered.checkin.${a}`, "en")}
          </Button>
        ))}
      </div>
      {answer.isError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {t("freered.checkin.error", "en")}
        </p>
      )}
    </section>
  );
}
