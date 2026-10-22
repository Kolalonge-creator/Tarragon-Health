"use client";

import { scheduleEntries, type VisitStatus } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAntenatalVisits } from "@/lib/queries/pregnancy-tools";

const STATUS_KEY: Record<VisitStatus, Parameters<typeof t>[0]> = {
  scheduled: "preg.ui.schedule.status_scheduled",
  completed: "preg.ui.schedule.status_completed",
  missed: "preg.ui.schedule.status_missed",
  cancelled: "preg.ui.schedule.status_cancelled",
};

/**
 * Antenatal schedule (S67, spec 16.5, CMO selection A5). Lists the rows the server generated from the versioned contact weeks. Dates are a
 * guide; an earlier visit is a decision for the care team and never changes this list by itself. Reminders for these visits use the one
 * generic string (`preg.reminder.visit`), which names no condition (INV-07).
 */
export function AntenatalSchedule({ patientId, currentWeek }: { patientId: string; currentWeek: number | null }) {
  const visits = useAntenatalVisits(patientId);
  const entries = scheduleEntries(visits.data ?? [], currentWeek);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preg.ui.schedule.title")}</CardTitle>
        <CardDescription>{t("preg.ui.schedule.intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm">{t("preg.ui.schedule.empty")}</p>
        ) : (
          <ol className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/20">
                <p className="font-medium">{t("preg.ui.schedule.visit", "en", { number: e.visitNumber })}</p>
                {e.week !== null && <p>{t("preg.ui.schedule.around_week", "en", { week: e.week })}</p>}
                <p>{e.overdue ? t("preg.ui.schedule.status_missed") : t(STATUS_KEY[e.status])}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
