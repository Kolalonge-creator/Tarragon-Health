"use client";

import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { useToolsStatus, useWeeklyDigest } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * A short, calm weekly note for a supporter (S69b). The database builds it from the permissions this supporter holds: days counted,
 * never a value, and a line is simply absent when its permission is not held. Renders nothing while the tool is off or if the read fails.
 */
export function WeeklyDigestCard({ patientId, locale }: { patientId: string; locale: Locale }) {
  const tools = useToolsStatus();
  const q = useWeeklyDigest(patientId, tools.data?.digest === true);
  if (tools.data?.digest !== true || q.isPending || q.isError || !q.data) return null;
  const d = q.data;
  const lines: string[] = [];
  if (d.doses && d.doses.days_with_doses > 0) lines.push(t("cctools.digest.doses", locale, { name: d.name, done: d.doses.days_all_taken, total: d.doses.days_with_doses }));
  if (d.readings) lines.push(t("cctools.digest.readings", locale, { name: d.name, days: d.readings.days_logged, span: d.days }));
  if (d.appointments?.next_at) lines.push(t("cctools.digest.next_appointment", locale, { date: formatPatientDate(d.appointments.next_at) }));
  if (d.tasks && (d.tasks.open > 0 || d.tasks.claimed > 0 || d.tasks.done > 0)) lines.push(t("cctools.digest.tasks", locale, { open: d.tasks.open, claimed: d.tasks.claimed, done: d.tasks.done }));
  return (
    <Card>
      <CardHeader><CardTitle>{t("cctools.digest.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className={`text-sm ${MUTED}`}>{t("cctools.digest.note", locale, { name: d.name })}</p>
        {lines.length === 0 ? <p>{t("cctools.digest.empty", locale)}</p> : <ul className="space-y-1">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      </CardContent>
    </Card>
  );
}
