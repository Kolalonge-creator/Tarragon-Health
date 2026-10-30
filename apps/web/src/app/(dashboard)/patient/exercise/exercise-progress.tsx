"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExerciseSessions,
  type ExerciseEnrollment,
  type ExerciseSessionLog,
} from "@/lib/queries/exercise";
import {
  dailyBars,
  programmeProgress,
  weekTotals,
  weeksInARow,
} from "@tarragon/clinical/exercise-progress";
import {
  EXERCISE_EFFORTS,
  EXERCISE_EFFORT_LABELS,
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
} from "@/lib/validation/exercise";
import {
  deleteExerciseSessionAction,
  logExerciseSessionAction,
  type LogSessionState,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyHint } from "@/components/ui/empty-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPatientDate, lagosToday } from "@/lib/format-date";

const SESSIONS_KEY = "exercise-sessions";

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayLetter(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Length of a programme's own week-by-week plan; the catalogue carries no other schedule. */
export function planWeeks(weeklyPlan: unknown): number {
  return Array.isArray(weeklyPlan) ? weeklyPlan.length : 0;
}

/**
 * The hero for this page: what the person did in the last 7 days. Everything shown is counted from logged sessions; with none logged it says
 * so rather than showing a zero ring or a target nobody set.
 */
export function ExerciseProgressHero({ patientId }: { patientId: string }) {
  const sessions = useExerciseSessions(patientId);
  const today = lagosToday();
  const data = useMemo(() => sessions.data ?? [], [sessions.data]);
  const bars = useMemo(() => dailyBars(data, today), [data, today]);
  const totals = weekTotals(bars);
  const run = weeksInARow(data, today);
  const peak = Math.max(1, ...bars.map((b) => b.minutes));

  if (sessions.isLoading)
    return <Skeleton className="h-44 w-full rounded-xl" />;
  if (sessions.isError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyHint>
            We couldn&apos;t load your sessions just now. Please try again in a
            moment.
          </EmptyHint>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
            Last 7 days
          </p>
          {data.length === 0 ? (
            <p className="mt-1 font-display text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
              No sessions logged yet
            </p>
          ) : (
            <p className="mt-1 font-display text-4xl font-semibold text-charcoal-ink dark:text-night-ink">
              {totals.minutes}
              <span className="ml-1 text-base font-medium text-charcoal-ink/60 dark:text-night-ink/60">
                minutes
              </span>
            </p>
          )}
          <p className="mt-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {data.length === 0
              ? "Log a session below and your week will start to fill in."
              : totals.sessions === 0
                ? "Nothing logged this week yet. A short walk counts."
                : `${plural(totals.sessions, "session", "sessions")} on ${plural(totals.activeDays, "day", "days")}.`}
          </p>
        </div>

        <div
          className="flex h-24 items-end gap-2"
          role="img"
          aria-label={`Minutes of exercise per day, last 7 days: ${bars.map((b) => `${weekdayLetter(b.date)} ${b.minutes}`).join(", ")}`}
        >
          {bars.map((b) => (
            <div
              key={b.date}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <div className="flex h-16 w-full items-end">
                <div
                  className={
                    b.minutes > 0
                      ? "w-full rounded-t-md bg-brand-green dark:bg-brand-green-bright"
                      : "w-full rounded-t-md bg-charcoal-ink/10 dark:bg-night-ink/15"
                  }
                  style={{
                    height:
                      b.minutes > 0
                        ? `${Math.max(12, Math.round((b.minutes / peak) * 100))}%`
                        : "4px",
                  }}
                />
              </div>
              <span
                className="text-[11px] text-charcoal-ink/60 dark:text-night-ink/60"
                aria-hidden
              >
                {weekdayLetter(b.date)}
              </span>
            </div>
          ))}
        </div>

        {run > 0 && totals.sessions > 0 && (
          <Badge variant="green">
            {run === 1 ? "Active this week" : `Active ${run} weeks in a row`}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

/** Where the person is in one programme's own plan, and what they logged against it. */
export function EnrolmentProgress({
  enrollment,
  sessions,
}: {
  enrollment: ExerciseEnrollment & {
    programme: { weekly_plan: unknown } | null;
  };
  sessions: readonly ExerciseSessionLog[];
}) {
  const weeks = planWeeks(enrollment.programme?.weekly_plan);
  if (enrollment.status !== "active" || weeks === 0) return null;
  const startedOn = lagosToday(new Date(enrollment.started_at));
  const p = programmeProgress(
    startedOn,
    weeks,
    sessions,
    enrollment.id,
    lagosToday(),
  );
  const elapsed = p.planLengthElapsed
    ? 100
    : Math.round(((p.currentWeek - 1) / p.totalWeeks) * 100);
  return (
    <div className="mt-2 space-y-1.5">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-brand-green dark:bg-brand-green-bright"
          style={{ width: `${Math.max(4, elapsed)}%` }}
        />
      </div>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        {p.planLengthElapsed
          ? `You have reached the end of the ${p.totalWeeks}-week plan.`
          : `Week ${p.currentWeek} of ${p.totalWeeks}.`}{" "}
        {p.sessionsLogged === 0
          ? "No sessions logged against it yet."
          : `${plural(p.sessionsLogged, "session", "sessions")}, ${p.minutesLogged} minutes logged.`}
      </p>
    </div>
  );
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function LogSessionCard({
  patientId,
  enrollments,
}: {
  patientId: string;
  enrollments: readonly (ExerciseEnrollment & {
    programme: { title: string } | null;
  })[];
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const today = lagosToday();
  const active = enrollments.filter((e) => e.status === "active");
  const [state, formAction, pending] = useActionState<
    LogSessionState,
    FormData
  >(async (prev, formData) => {
    const result = await logExerciseSessionAction(prev, formData);
    if (result?.success) {
      queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY, patientId] });
      formRef.current?.reset();
    }
    return result;
  }, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a session</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ex-day">Day</Label>
              <Input
                id="ex-day"
                name="performed_on"
                type="date"
                defaultValue={today}
                min={shiftDate(today, -30)}
                max={today}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ex-minutes">Minutes</Label>
              <Input
                id="ex-minutes"
                name="duration_minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                placeholder="e.g. 20"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ex-kind">What did you do?</Label>
              <Select id="ex-kind" name="kind" defaultValue="walking">
                {EXERCISE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EXERCISE_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ex-effort">How did it feel? (optional)</Label>
              <Select id="ex-effort" name="effort" defaultValue="">
                <option value="">Skip</option>
                {EXERCISE_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {EXERCISE_EFFORT_LABELS[e]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {active.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="ex-programme">
                Part of a programme? (optional)
              </Label>
              <Select
                id="ex-programme"
                name="enrollment_id"
                defaultValue={active.length === 1 ? active[0].id : ""}
              >
                <option value="">Not part of a programme</option>
                {active.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.programme?.title ?? "Programme"}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
            <input type="checkbox" name="symptom_during" className="mt-1" />
            <span>
              I had chest pain, dizziness or unusual breathlessness during it
            </span>
          </label>

          <div className="grid gap-1.5">
            <Label htmlFor="ex-note">Note (optional)</Label>
            <Textarea
              id="ex-note"
              name="note"
              rows={2}
              maxLength={300}
              placeholder="Anything you want to remember"
            />
          </div>

          {state?.error && (
            <p
              role="alert"
              className="text-sm text-destructive dark:text-red-400"
            >
              {state.error}
            </p>
          )}
          {state?.success && state.symptomReported && (
            <div
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
            >
              Thank you for telling us. Please stop and rest now. If the chest
              pain, dizziness or breathlessness has not eased, or you feel
              faint, go to the nearest hospital now. Even if it passes, mention
              it to your care team before your next session.
            </div>
          )}
          {state?.success && !state.symptomReported && (
            <p
              role="status"
              className="text-sm text-brand-green dark:text-brand-green-bright"
            >
              Logged. Well done.
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Log session"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function RecentSessions({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const sessions = useExerciseSessions(patientId);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const recent = (sessions.data ?? []).slice(0, 10);
  if (sessions.isLoading || recent.length === 0) return null;

  async function remove(id: string) {
    setError(null);
    setRemoving(id);
    const result = await deleteExerciseSessionAction(id);
    setRemoving(null);
    if (result?.error) {
      setError(result.error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY, patientId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sessions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recent.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {formatPatientDate(s.performed_on, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                : {s.duration_minutes} min,{" "}
                {EXERCISE_KIND_LABELS[
                  s.kind as keyof typeof EXERCISE_KIND_LABELS
                ]?.toLowerCase() ?? s.kind}
              </p>
              {(s.effort || s.symptom_during) && (
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {s.effort
                    ? EXERCISE_EFFORT_LABELS[
                        s.effort as keyof typeof EXERCISE_EFFORT_LABELS
                      ]
                    : ""}
                  {s.effort && s.symptom_during ? " · " : ""}
                  {s.symptom_during ? "You noted a symptom" : ""}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(s.id)}
              disabled={removing === s.id}
              aria-label={`Remove the session on ${s.performed_on}`}
            >
              Remove
            </Button>
          </div>
        ))}
        {error && (
          <p
            role="alert"
            className="text-sm text-destructive dark:text-red-400"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
