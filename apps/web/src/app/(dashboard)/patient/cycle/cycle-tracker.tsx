"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  useCycleTracker,
  useEndPeriod,
  useLogPeriod,
  useDeletePeriod,
} from "@/lib/queries/menstrual-cycle";
import {
  FERTILE_WINDOW_DISCLAIMER,
  PHASE_DESCRIPTION,
  PHASE_LABEL,
  type CycleClinicalFlag,
  type CyclePrediction,
  type ReproductiveLifeStage,
} from "@/lib/rules/cycle-prediction";
import { suggestCycleReading } from "@/lib/rules/cycle-reading";
import { CycleCalendar } from "./cycle-calendar";
import { CycleInsightsCard } from "./cycle-insights-card";
import { CycleLengthChart } from "./cycle-length-chart";
import { CycleDayLog } from "./cycle-day-log";
import { CycleLegend, CycleRing } from "./cycle-ring";

import { formatPatientDate } from "@/lib/format-date";
/**
 * The cycle tracker page body.
 *
 * Everything shown here is derived from one call to the pure prediction
 * engine (see lib/rules/cycle-prediction.ts), so the ring, the calendar, the
 * numbers and the clinical flags can never disagree with each other.
 */

function longDate(iso: string | null): string {
  if (!iso) return "-";
  return formatPatientDate(`${iso}T00:00:00Z`, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function shortDate(iso: string | null): string {
  if (!iso) return "-";
  return formatPatientDate(`${iso}T00:00:00Z`, {
    day: "numeric",
    month: "short",
  });
}

const CONFIDENCE_BADGE: Record<
  CyclePrediction["confidence"],
  { variant: "grey" | "amber" | "blue" | "green"; label: string }
> = {
  none: { variant: "grey", label: "No estimate yet" },
  low: { variant: "amber", label: "Rough estimate" },
  medium: { variant: "blue", label: "Fairly confident" },
  high: { variant: "green", label: "Confident" },
};

function FlagCard({ flags }: { flags: CycleClinicalFlag[] }) {
  if (flags.length === 0) return null;
  const urgent = flags.filter((flag) => flag.severity === "urgent");
  const rest = flags.filter((flag) => flag.severity !== "urgent");

  return (
    <div className="space-y-3">
      {urgent.map((flag) => (
        <div
          key={flag.id}
          // An urgent flag is the one place on this page that borrows the
          // clinical red, because it is the one place something is actually
          // wrong rather than simply being a phase of a normal cycle.
          className="rounded-lg border-l-4 border-red-600 bg-red-50 dark:bg-red-500/15 p-4"
          role="alert"
        >
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{flag.label}</p>
          <p className="mt-1 text-sm text-red-900/80 dark:text-red-200">{flag.detail}</p>
          <Link
            href="/patient/messages"
            className="mt-2 inline-block text-sm font-medium text-red-800 dark:text-red-300 underline"
          >
            Message your care team
          </Link>
        </div>
      ))}

      {rest.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worth mentioning to your care team</CardTitle>
            <CardDescription>
              These are patterns we noticed in what you logged. None of them is an emergency.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rest.map((flag) => (
              <div key={flag.id}>
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{flag.label}</p>
                <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{flag.detail}</p>
              </div>
            ))}
            <Link
              href="/patient/messages"
              className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright underline"
            >
              Message your care team
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-warm-ivory dark:bg-night-ink/10 p-3">
      <p className="text-[11px] uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-charcoal-ink dark:text-night-ink">{value}</p>
      {hint && <p className="text-[11px] text-charcoal-ink/60 dark:text-night-ink/60">{hint}</p>}
    </div>
  );
}

export function CycleTracker({
  patientId,
  organisationId,
  lifeStage,
  selfReportedCycleLengthDays,
}: {
  patientId: string;
  organisationId: string;
  lifeStage: ReproductiveLifeStage;
  selfReportedCycleLengthDays: number | null;
}) {
  const { cycles, dailyLogs, prediction, insights, thermalShift, openCycle, today, isLoading, error } = useCycleTracker(
    patientId,
    lifeStage,
    selfReportedCycleLengthDays
  );
  const logPeriod = useLogPeriod();
  const endPeriod = useEndPeriod();
  const deletePeriod = useDeletePeriod();

  const [selectedDate, setSelectedDate] = useState(today);

  const selectedLog = dailyLogs.find((log) => log.log_date === selectedDate) ?? null;
  const { stats } = prediction;
  const confidence = CONFIDENCE_BADGE[prediction.confidence];
  const hasHistory = cycles.length > 0;
  const reading = suggestCycleReading({
    phase: prediction.currentPhase,
    lifeStage,
    isIrregular: stats.regularity === "irregular",
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Loading your cycle...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
          We could not load your cycle just now. Please refresh and try again.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <FlagCard flags={prediction.flags} />

      {/* ---------- Where you are now ---------- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
              Your cycle
            </CardTitle>
            <Badge variant={confidence.variant}>{confidence.label}</Badge>
          </div>
          <CardDescription>{prediction.confidenceReason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CycleRing prediction={prediction} />
          <CycleLegend />

          {prediction.currentPhase !== "unknown" && (
            <p className="rounded-lg bg-soft-sage/50 dark:bg-brand-green/10 p-3 text-center text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <span className="font-medium">{PHASE_LABEL[prediction.currentPhase]}.</span>{" "}
              {PHASE_DESCRIPTION[prediction.currentPhase]}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {openCycle ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={endPeriod.isPending}
                onClick={() =>
                  endPeriod.mutate({ patientId, cycleId: openCycle.id, endDate: today })
                }
              >
                {endPeriod.isPending ? "Saving..." : "My period has ended"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={logPeriod.isPending}
                onClick={() =>
                  logPeriod.mutate({
                    patientId,
                    organisationId,
                    periodStartDate: today,
                  })
                }
              >
                {logPeriod.isPending ? "Saving..." : "My period started today"}
              </Button>
            )}
            {/* Backdating is the common case (people log a day or two late),
                but a FUTURE start date is never a real observation: it would
                be inserted as history and silently corrupt every cycle
                length, prediction and clinical flag derived from it. There is
                no database guard for this — a CHECK cannot call current_date,
                which is not immutable — so the gate has to live here. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (selectedDate === today || selectedDate > today) return;
                logPeriod.mutate({
                  patientId,
                  organisationId,
                  periodStartDate: selectedDate,
                });
              }}
              disabled={selectedDate === today || selectedDate > today || logPeriod.isPending}
              title={
                selectedDate > today
                  ? "You can only log a period that has already started"
                  : selectedDate === today
                    ? "Pick an earlier day on the calendar first"
                    : undefined
              }
            >
              It started on {shortDate(selectedDate)}
            </Button>
          </div>
          {logPeriod.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {(logPeriod.error as Error)?.message ?? "Could not save that."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------- What to expect ---------- */}
      {hasHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What to expect</CardTitle>
            <CardDescription>
              Estimates from your own logged cycles. They are not a promise, and they get
              sharper each time you log a period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                // Once it is overdue, calling a date in the past "next period"
                // reads as though the app has not noticed.
                label={prediction.isOverdue ? "Was expected" : "Next period"}
                value={longDate(prediction.predictedNextPeriodDate)}
                hint={
                  prediction.predictedNextPeriodEarliest
                    ? `Most likely between ${shortDate(prediction.predictedNextPeriodEarliest)} and ${shortDate(prediction.predictedNextPeriodLatest)}`
                    : undefined
                }
              />
              <Stat
                label="Estimated ovulation"
                value={longDate(prediction.predictedOvulationDate)}
                hint={
                  prediction.fertileWindowStart
                    ? `Fertile window ${shortDate(prediction.fertileWindowStart)} to ${shortDate(prediction.fertileWindowEnd)}`
                    : undefined
                }
              />
            </div>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{FERTILE_WINDOW_DISCLAIMER}</p>
          </CardContent>
        </Card>
      )}

      {/* ---------- Calendar + day log ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar</CardTitle>
          <CardDescription>
            Pick any day to see or add what happened. Tap a day, then use the button above to
            record that your period started then.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <CycleCalendar
            cycles={cycles}
            dailyLogs={dailyLogs}
            prediction={prediction}
            today={today}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <div className="border-t pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <CycleDayLog
              // Remount per day so the form re-seeds from that day's log.
              key={selectedDate}
              patientId={patientId}
              organisationId={organisationId}
              date={selectedDate}
              existing={selectedLog}
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------- Patterns ---------- */}
      {stats.usedCycles > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your patterns</CardTitle>
            <CardDescription>
              Measured from the {stats.usedCycles} most recent cycle
              {stats.usedCycles === 1 ? "" : "s"} you logged.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Average cycle"
              value={`${stats.averageCycleLengthDays} days`}
              hint={
                stats.shortestCycleDays !== null
                  ? `Ranged ${stats.shortestCycleDays} to ${stats.longestCycleDays} days`
                  : undefined
              }
            />
            <Stat
              label="Period length"
              value={
                stats.averagePeriodDurationDays !== null
                  ? `${stats.averagePeriodDurationDays} days`
                  : "Not logged"
              }
              hint={
                stats.averagePeriodDurationDays === null
                  ? "Tap 'my period has ended' to track this"
                  : undefined
              }
            />
            <Stat
              label="Regularity"
              value={stats.regularity === "regular" ? "Regular" : stats.regularity === "irregular" ? "Variable" : "Not enough data"}
              hint={
                stats.variationDays !== null
                  ? `${stats.variationDays} ${stats.variationDays === 1 ? "day" : "days"} between your shortest and longest`
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {/* ---------- Patterns over time ---------- */}
      <CycleInsightsCard
        insights={insights}
        thermalShift={thermalShift}
        hasAnyLogs={dailyLogs.length > 0}
      />

      <CycleLengthChart stats={stats} />

      {reading.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worth a read</CardTitle>
            <CardDescription>
              From your care team&apos;s health library, picked for where you are right now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {reading.map((item) => (
              <Link
                key={item.code}
                href="/patient/learn"
                className="flex items-start justify-between gap-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3 hover:bg-charcoal-ink/5 dark:hover:bg-night-ink/10"
              >
                <span>
                  <span className="block text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {item.title}
                  </span>
                  <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{item.reason}</span>
                </span>
                <span aria-hidden className="text-brand-green dark:text-brand-green-bright">
                  &rarr;
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---------- History ---------- */}
      {hasHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Periods you have logged</CardTitle>
            <CardDescription>
              Remove any that were logged by mistake. A wrong start date changes every estimate
              that comes after it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {cycles.slice(0, 12).map((cycle) => (
                <li key={cycle.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-charcoal-ink dark:text-night-ink">
                    {longDate(cycle.period_start_date)}
                    {cycle.period_end_date ? ` to ${shortDate(cycle.period_end_date)}` : " (open)"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={deletePeriod.isPending}
                    onClick={() => deletePeriod.mutate({ patientId, cycleId: cycle.id })}
                    aria-label={`Remove the period logged on ${longDate(cycle.period_start_date)}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        Your cycle information is part of your health record. Your care team can see it; nobody
        else can. It is never used to score your health risk.
      </p>
    </div>
  );
}
