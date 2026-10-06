"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { useRevokeMember, useSupportedPeople, useSupporterView } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * What a supporter sees about the person they support: one read, and only the blocks the database sent. A block that is absent is
 * simply not shared; this component never asks for it another way. Read only: no export, no copy button, no raw readings.
 */
export function SupporterView({ patientId, locale }: { patientId: string; locale: Locale }) {
  const router = useRouter();
  const view = useSupporterView(patientId);
  const people = useSupportedPeople();
  const leave = useRevokeMember();
  const memberId = people.data?.find((p) => p.patient_id === patientId)?.member_id;

  if (view.isPending) return <p className={MUTED} role="status">…</p>;
  const v = view.data;
  if (!v) return <p role="alert">{t("circle.view.not_found", locale)}</p>;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="font-heading text-xl font-semibold">{v.name}</h2>
        <p className={MUTED}>{t("circle.view.privacy", locale, { name: v.name })}</p>
        <p className={`text-sm ${MUTED}`}>{t("circle.view.shared_until", locale, { date: formatPatientDate(v.shared_until) })}</p>
      </header>

      {v.adherence ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.adherence.title", locale)}</CardTitle></CardHeader>
          <CardContent>
            {v.adherence.due === 0 || v.adherence.percent === null ? (
              <p className={MUTED}>{t("circle.view.adherence.none", locale)}</p>
            ) : (
              <p>{t("circle.view.adherence.line", locale, { taken: v.adherence.taken, due: v.adherence.due, percent: v.adherence.percent })}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {v.bp_trend ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.bp.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {v.bp_trend.weeks.length === 0 ? <p className={MUTED}>{t("circle.view.bp.none", locale)}</p> : null}
            <ul className="space-y-1">
              {v.bp_trend.weeks.map((w) => (
                <li key={w.week_start}>
                  {t("circle.view.bp.row", locale, { date: formatPatientDate(w.week_start), systolic: w.systolic, diastolic: w.diastolic, count: w.readings })}
                </li>
              ))}
            </ul>
            {v.bp_trend.direction ? <p className="font-medium">{t(`circle.view.bp.${v.bp_trend.direction}`, locale)}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {v.appointments ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.appt.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p>{v.appointments.next_at ? t("circle.view.appt.next", locale, { date: formatPatientDateTime(v.appointments.next_at) }) : t("circle.view.appt.none", locale)}</p>
            <p className={MUTED}>{t("circle.view.appt.missed", locale, { count: v.appointments.missed_30d })}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {v.can_pay ? (
          <Button asChild className={TOUCH}>
            <Link href={`/patient/supporting/circle/${patientId}/pay`}>{t("circle.view.pay", locale)}</Link>
          </Button>
        ) : null}
        {memberId ? (
          <Button
            type="button"
            variant="outline"
            className={TOUCH}
            disabled={leave.isPending}
            onClick={async () => {
              if (!window.confirm(t("circle.view.leave_confirm", locale, { name: v.name }))) return;
              await leave.mutateAsync(memberId);
              router.push("/patient/supporting");
            }}
          >
            {t("circle.view.leave", locale)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
