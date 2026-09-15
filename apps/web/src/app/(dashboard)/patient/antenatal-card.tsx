"use client";

import { useActionState, useMemo } from "react";
import { setLastMenstrualPeriod } from "./womens-health-actions";
import { useAntenatalVisits } from "@/lib/queries/womens-health";
import { computeGestationalEstimate } from "@/lib/rules/gestational-age";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

import { formatPatientDate } from "@/lib/format-date";
/**
 * Antenatal tracking (§44.6/44.7): a gestational-week estimate (never
 * presented as a confirmed clinical dating — see lib/rules/gestational-age.ts)
 * plus the visit checklist recorded via antenatal_visits. Booking an actual
 * visit happens through the existing appointment engine
 * (/patient/appointments); investigations/scans/vaccinations already have
 * real homes (lab results, vaccination registry) — this card is the
 * gestational-timeline summary, not a parallel booking surface.
 */
export function AntenatalCard({
  patientId,
  lastMenstrualPeriodDate,
  estimatedDueDate,
  highRisk,
}: {
  patientId: string;
  lastMenstrualPeriodDate: string | null;
  estimatedDueDate: string | null;
  highRisk: boolean;
}) {
  const visits = useAntenatalVisits(patientId);
  const [state, formAction, pending] = useActionState(setLastMenstrualPeriod, undefined);
  const lmpErrorId = fieldErrorId("last_menstrual_period_date");

  const estimate = useMemo(
    () => computeGestationalEstimate({ lastMenstrualPeriodDate, estimatedDueDate }),
    [lastMenstrualPeriodDate, estimatedDueDate]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antenatal care</CardTitle>
        <CardDescription>
          Track your appointments, investigations, scans and vaccinations through pregnancy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {highRisk && (
          <div className="rounded-md border border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10 p-3 text-sm text-charcoal-ink/90 dark:text-night-ink/90">
            <p className="font-medium text-amber-800 dark:text-amber-300">Your care team has flagged this pregnancy for closer follow-up</p>
            <p className="mt-1">Keep your antenatal appointments and reach out if anything changes.</p>
          </div>
        )}

        {estimate ? (
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            Estimated {estimate.weeks} weeks pregnant. This is an estimate, not a confirmed clinical
            dating. Estimated due date: {formatPatientDate(estimate.estimatedDueDate)}.
          </p>
        ) : (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Add your last menstrual period date for a gestational-age estimate.
          </p>
        )}

        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="last_menstrual_period_date">Last menstrual period date</Label>
            <Input
              id="last_menstrual_period_date"
              name="last_menstrual_period_date"
              type="date"
              defaultValue={lastMenstrualPeriodDate ?? ""}
              {...fieldErrorProps(lmpErrorId, Boolean(state?.error))}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
        <FormError id={lmpErrorId} message={state?.error} />

        {visits.data && visits.data.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
              Antenatal visits
            </p>
            <ul className="space-y-2">
              {visits.data.map((visit) => (
                <li key={visit.id} className="rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {visit.gestational_week_at_visit != null
                        ? `Week ${visit.gestational_week_at_visit}`
                        : `Visit ${visit.visit_number ?? ""}`}
                    </span>
                    <span className="text-xs capitalize text-charcoal-ink/60 dark:text-night-ink/60">{visit.status}</span>
                  </div>
                  {visit.findings && <p className="mt-1 text-charcoal-ink/70 dark:text-night-ink/70">{visit.findings}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <a
          href="/patient/appointments"
          className="inline-block text-sm font-medium text-deep-forest dark:text-brand-green-bright underline underline-offset-2"
        >
          Book your next antenatal visit
        </a>
      </CardContent>
    </Card>
  );
}
