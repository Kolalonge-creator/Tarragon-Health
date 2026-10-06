"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { ALERT_MODES, type AlertMode, type OpenAlert, type SupportedPerson } from "@/lib/care-circle/model";
import { useAckAlert, useOpenAlerts, useSetAlertMode, useSupportedPeople } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/** A check-in request: a name and a request to call. "I called them" is one status, with no text, private to this supporter. */
function AlertCard({ alert, locale }: { alert: OpenAlert; locale: Locale }) {
  const ack = useAckAlert();
  const [failed, setFailed] = useState(false);
  return (
    <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
      <p className="font-heading text-base font-semibold">{t("circle.alert.title", locale, { name: alert.name })}</p>
      <p className="mt-1 text-sm">{t("circle.alert.body", locale, { name: alert.name })}</p>
      {alert.called ? (
        <p className="mt-3 text-sm font-medium" role="status">{t("circle.alert.called_done", locale)}</p>
      ) : (
        <Button
          type="button"
          className="mt-3 min-h-11"
          disabled={ack.isPending}
          onClick={async () => {
            setFailed(false);
            try {
              await ack.mutateAsync(alert.patient_id);
            } catch {
              setFailed(true);
            }
          }}
        >
          {t("circle.alert.called", locale)}
        </Button>
      )}
      <FormError id={`ack-error-${alert.patient_id}`} message={failed ? t("circle.alert.error", locale) : null} />
    </div>
  );
}

const MODE_KEYS = { push_and_app: "circle.supporting.alert_mode.push_and_app", app_only: "circle.supporting.alert_mode.app_only" } as const;

/** Only for someone who can receive check-in requests. The push can be dropped; the request in the app cannot be, and there are no quiet hours. */
function AlertMode({ person, locale }: { person: SupportedPerson; locale: Locale }) {
  const set = useSetAlertMode();
  const id = `alert-mode-${person.member_id}`;
  return (
    <div className="mt-2 space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{t("circle.supporting.alert_mode", locale, { name: person.name })}</label>
      <select
        id={id}
        className="min-h-11 w-full max-w-sm rounded-md border bg-transparent px-3"
        value={person.alert_mode}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ patientId: person.patient_id, mode: e.target.value as AlertMode })}
      >
        {ALERT_MODES.map((m) => (
          <option key={m} value={m}>{t(MODE_KEYS[m], locale)}</option>
        ))}
      </select>
      {person.alert_mode === "app_only" ? <p className={`text-sm ${MUTED}`}>{t("circle.supporting.alert_mode.note", locale)}</p> : null}
    </div>
  );
}

/** The Care Circle half of the supporter's home: any open check-in request first, then the people who have shared something. */
export function CircleSupporting({ locale }: { locale: Locale }) {
  const people = useSupportedPeople();
  const alerts = useOpenAlerts();
  const list = people.data ?? [];
  const open = alerts.data ?? [];
  if (people.isSuccess && list.length === 0 && open.length === 0) return null;

  return (
    <div className="space-y-4">
      {open.map((a) => <AlertCard key={a.patient_id} alert={a} locale={locale} />)}
      <Card>
        <CardHeader><CardTitle>{t("circle.supporting.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {list.map((p) => {
              const needsAttention = open.some((a) => a.patient_id === p.patient_id && !a.called);
              return (
                <li key={p.member_id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {p.name}
                        {needsAttention ? <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium">{t("circle.supporting.needs_attention", locale)}</span> : null}
                      </p>
                      <p className={`text-sm ${MUTED}`}>
                        {t("circle.supporting.relationship", locale, { relationship: p.relationship })} · {t("circle.view.shared_until", locale, { date: formatPatientDate(p.expires_at) })}
                      </p>
                    </div>
                    <Button asChild className="min-h-11">
                      <Link href={`/patient/supporting/circle/${p.patient_id}`}>{t("circle.supporting.open", locale)}</Link>
                    </Button>
                  </div>
                  {p.permissions.includes("red_alerts") ? <AlertMode person={p} locale={locale} /> : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
