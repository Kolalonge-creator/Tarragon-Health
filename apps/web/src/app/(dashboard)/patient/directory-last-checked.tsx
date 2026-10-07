"use client";

import { t } from "@tarragon/i18n";
import { formatPatientDate } from "@/lib/format-date";
import { useDirectoryLastChecked, type PatientListingTable } from "@/lib/queries/directory-last-checked";

/**
 * "Details last checked <date>" under a lab branch or pharmacy listing. A listing past its check date adds a gentle note to
 * confirm before going; it is never hidden or marked unavailable (stale means a notice only, decision S-19).
 */
export function DirectoryLastChecked({ table, id }: { table: PatientListingTable; id: string }) {
  const { data } = useDirectoryLastChecked(table, id);
  if (!data) return null;
  return (
    <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50" data-testid="directory-last-checked">
      {t("dirfresh.patient.last_checked", "en", { date: formatPatientDate(data.last_checked) })}
      {data.is_overdue ? ` ${t("dirfresh.patient.overdue_note", "en")}` : ""}
    </p>
  );
}
