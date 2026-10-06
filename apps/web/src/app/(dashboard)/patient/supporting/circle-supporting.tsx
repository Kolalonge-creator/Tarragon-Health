"use client";

import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDate } from "@/lib/format-date";
import { useOpenAlerts, useSupportedPeople } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/** The Care Circle half of the supporter's home: any open check-in request first, then the people who have shared something. */
export function CircleSupporting({ locale }: { locale: Locale }) {
  const people = useSupportedPeople();
  const alerts = useOpenAlerts();
  const list = people.data ?? [];
  if (people.isSuccess && list.length === 0 && (alerts.data?.length ?? 0) === 0) return null;

  return (
    <div className="space-y-4">
      {(alerts.data ?? []).map((a) => (
        <div key={a.patient_id} role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
          <p className="font-heading text-base font-semibold">{t("circle.alert.title", locale, { name: a.name })}</p>
          <p className="mt-1 text-sm">{t("circle.alert.body", locale, { name: a.name })}</p>
        </div>
      ))}
      <Card>
        <CardHeader><CardTitle>{t("circle.supporting.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {list.map((p) => (
              <li key={p.member_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className={`text-sm ${MUTED}`}>
                    {t("circle.supporting.relationship", locale, { relationship: p.relationship })} · {t("circle.view.shared_until", locale, { date: formatPatientDate(p.expires_at) })}
                  </p>
                </div>
                <Button asChild className="min-h-11">
                  <Link href={`/patient/supporting/circle/${p.patient_id}`}>{t("circle.supporting.open", locale)}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
