"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { supporterDoseState, type SupporterDoseState } from "@tarragon/medicines";
import { useSupporterTodaysDoses } from "@/lib/queries/medicine-safety";

const STATE_KEY: Record<SupporterDoseState, "supporter.doses.taken" | "supporter.doses.skipped" | "supporter.doses.no_record_yet" | "supporter.doses.not_due_yet"> = {
  taken: "supporter.doses.taken",
  skipped: "supporter.doses.skipped",
  no_record_yet: "supporter.doses.no_record_yet",
  not_due_yet: "supporter.doses.not_due_yet",
};

/**
 * "Was today's dose taken", read only, for someone who shared their medicines with you (S08y). The database answers only when the
 * person granted the medicines category and the supporter view is switched on; otherwise this renders nothing at all, so a supporter
 * without the category sees no hint that a list exists. A failed read says so; it never shows an empty list that could read as "all done".
 */
export function SupporterTodaysDoses({ patientId, name, hasMedicinesCategory }: { patientId: string; name: string; hasMedicinesCategory: boolean }) {
  const { data, isLoading, isError } = useSupporterTodaysDoses(patientId, hasMedicinesCategory);
  // Read once per mount: the state of a dose is judged against this moment, and a re-render must not flip it.
  const [now] = useState(() => Date.now());
  if (!hasMedicinesCategory || isLoading) return null;
  if (isError || data?.status === "unreadable") {
    return <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t("supporter.doses.unreadable")}</p>;
  }
  if (!data || data.status !== "ok") return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("supporter.doses.title")}</p>
      {data.doses.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {t(data.activeMedicines === 0 ? "supporter.doses.no_medicines" : "supporter.doses.none_scheduled")}
        </p>
      ) : (
        <ul className="space-y-1">
          {data.doses.map((dose) => (
            <li key={`${dose.medicationId}-${dose.time}`} className="flex flex-wrap items-center gap-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <span>
                {dose.time} · {dose.name}
              </span>
              <span className="text-charcoal-ink/60 dark:text-night-ink/60">{t(STATE_KEY[supporterDoseState(dose, now)])}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{t("supporter.doses.schedule_only")}</p>
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{t("supporter.doses.read_only", undefined, { name })}</p>
    </div>
  );
}
