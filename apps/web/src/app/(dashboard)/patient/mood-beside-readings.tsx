"use client";

import { useMoodBesideReadings } from "@/lib/queries/mood-trend";
import { wellbeingTagLabel } from "@/lib/validation/wellbeing";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { useSharedPhone } from "@/lib/mental-health/shared-phone";

/**
 * Mood beside blood pressure and sleep (10.1): one row per day, so a patient can see how a hard week and a high reading landed on the
 * same days. A plain table, not a chart (low bandwidth, screen readers, a small phone). It states no cause and gives no score. In
 * shared-phone mode the rows are hidden until the patient chooses to show them.
 */
export function MoodBesideReadings({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useMoodBesideReadings(patientId);
  const { hidden } = useSharedPhone();
  const rows = [...(data ?? [])].reverse().slice(0, 14);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("mood.beside.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hidden ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("mood.beside.hidden")}</p>
        ) : isLoading ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("mood.beside.loading")}</p>
        ) : isError ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("mood.beside.error")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("mood.beside.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("mood.beside.table")}</caption>
              <thead>
                <tr className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <th scope="col" className="py-1 pr-3 font-medium">{t("mood.beside.col_day")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("mood.beside.col_mood")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("mood.beside.col_stress")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("mood.beside.col_bp")}</th>
                  <th scope="col" className="py-1 font-medium">{t("mood.beside.col_sleep")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day} className="border-t border-charcoal-ink/10 dark:border-night-ink/15 align-top">
                    <th scope="row" className="py-1.5 pr-3 font-normal">{formatPatientDate(`${r.day}T12:00:00+01:00`, { day: "numeric", month: "short" })}</th>
                    <td className="py-1.5 pr-3">
                      {r.mood ?? "-"}
                      {r.tags.length > 0 && (
                        <span className="block text-xs text-charcoal-ink/55 dark:text-night-ink/55">
                          {r.tags.map((tag) => wellbeingTagLabel(tag)).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{r.stress ?? "-"}</td>
                    <td className="py-1.5 pr-3">{r.systolic !== null && r.diastolic !== null ? `${r.systolic}/${r.diastolic}` : "-"}</td>
                    <td className="py-1.5">{r.sleepMinutes !== null ? `${Math.floor(r.sleepMinutes / 60)}h ${r.sleepMinutes % 60}m` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">{t("mood.beside.caption")}</p>
      </CardContent>
    </Card>
  );
}
