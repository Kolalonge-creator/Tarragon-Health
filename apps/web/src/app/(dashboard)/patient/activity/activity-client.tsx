"use client";

import { useActionState, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useActivityGoal,
  useActivityEntries,
  useTodaySteps,
  useWeeklyActivityMinutes,
  type ActivityEntry,
} from "@/lib/queries/activity";
import { useLatestWeightKg } from "@/lib/queries/vitals";
import { classifyActivity, caloriesBurned, WHO_WEEKLY_TARGET_MINUTES } from "@/lib/activity/intensity";
import {
  setActivityGoalAction,
  logStepsAction,
  logWorkoutAction,
  toggleActivityFavoriteAction,
  type ActivityActionState,
} from "./actions";
import { COMMON_ACTIVITY_NAMES } from "@/lib/validation/activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";
const GOAL_QUERY_KEY = "activity-goal";
const TODAY_STEPS_KEY = "today-steps";
const ENTRIES_KEY = "activity-entries";
const WEEKLY_MINUTES_KEY = "weekly-activity-minutes";

function StepRing({ current, goal }: { current: number; goal: number }) {
  const size = 176;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = goal > 0 ? Math.min(1, current / goal) : 0;
  const offset = circumference * (1 - pct);

  return (
    <div className="relative flex h-44 w-44 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-charcoal-ink, #e5e5e0)"
          strokeOpacity={0.1}
          strokeWidth={stroke}
          // The ink track doesn't flip with the theme; the class wins over
          // the presentation attribute in dark only, so light is untouched.
          className="dark:stroke-night-ink"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-sprout-gold, #d99a2b)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <p className="text-[10px] font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
          {goal.toLocaleString()} step goal
        </p>
        <p className="font-heading text-3xl font-semibold text-charcoal-ink dark:text-night-ink">
          {current.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function lagosDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

function groupLabel(dateKey: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", {
    timeZone: "Africa/Lagos",
  });
  if (dateKey === today) return "Today";
  if (dateKey === yesterday) return "Yesterday";
  return formatPatientDate(dateKey, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function ActivityClient({ patientId }: { patientId: string }) {
  const goal = useActivityGoal(patientId);
  const todaySteps = useTodaySteps(patientId);
  const entries = useActivityEntries(patientId);
  const weeklyMinutes = useWeeklyActivityMinutes(patientId);
  const latestWeight = useLatestWeightKg(patientId);

  const stepGoal = goal.data?.daily_step_goal ?? 7500;

  const grouped = useMemo(() => {
    const rows = entries.data ?? [];
    const map = new Map<string, ActivityEntry[]>();
    for (const row of rows) {
      const key = lagosDateKey(row.logged_at);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries.data]);

  return (
    <div className="space-y-6">
      <TodayCard
        patientId={patientId}
        currentSteps={todaySteps.data ?? 0}
        stepGoal={stepGoal}
        loading={todaySteps.isLoading || goal.isLoading}
      />

      <LogWorkoutCard patientId={patientId} />

      <WeeklyGuidelineCard minutes={weeklyMinutes.data} loading={weeklyMinutes.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
          {!entries.isLoading && grouped.length === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing logged yet.</p>
          )}
          <div className="space-y-5">
            {grouped.map(([dateKey, rows]) => (
              <div key={dateKey}>
                <p className="mb-2 text-sm font-semibold text-charcoal-ink dark:text-night-ink">{groupLabel(dateKey)}</p>
                <ul className="space-y-2">
                  {rows.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      patientId={patientId}
                      weightKg={latestWeight.data?.weight_kg ?? null}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WeeklyGuidelineCard({ minutes, loading }: { minutes: number | undefined; loading: boolean }) {
  const total = minutes ?? 0;
  const progressPct = Math.min(100, Math.round((total / WHO_WEEKLY_TARGET_MINUTES) * 100));

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week&apos;s activity guideline</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              WHO recommends {WHO_WEEKLY_TARGET_MINUTES} minutes of moderate activity a week (vigorous
              minutes count double). You&apos;re at{" "}
              <span className="font-semibold text-charcoal-ink dark:text-night-ink">{total} min</span> from this week&apos;s
              logged workouts.
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15">
              <div
                className="h-full rounded-full bg-brand-green transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {progressPct >= 100 ? "Weekly guideline reached, nice work." : `${progressPct}% of the way there.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TodayCard({
  patientId,
  currentSteps,
  stepGoal,
  loading,
}: {
  patientId: string;
  currentSteps: number;
  stepGoal: number;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remaining = Math.max(0, stepGoal - currentSteps);

  const [state, formAction] = useActionState<ActivityActionState, FormData>(
    async (prev, formData) => {
      const intent = formData.get("_intent");
      const result =
        intent === "goal" ? await setActivityGoalAction(prev, formData) : await logStepsAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [GOAL_QUERY_KEY, patientId] });
        queryClient.invalidateQueries({ queryKey: [TODAY_STEPS_KEY, patientId] });
        queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
        setEditing(false);
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Today</CardTitle>
          {!loading && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {remaining > 0 ? `Try for ${remaining.toLocaleString()} more steps today` : "Goal reached, nice work"}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? "Close" : "Edit steps"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          <StepRing current={currentSteps} goal={stepGoal} />
        </div>

        {editing && (
          <div className="grid gap-4 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4 sm:grid-cols-2">
            <form action={formAction} className="space-y-2">
              <input type="hidden" name="_intent" value="steps" />
              <Label htmlFor="step_count">Log today&apos;s steps</Label>
              <Input
                id="step_count"
                name="step_count"
                type="number"
                min={0}
                defaultValue={currentSteps || undefined}
                required
              />
              <Button type="submit" size="sm">
                Save steps
              </Button>
            </form>
            <form action={formAction} className="space-y-2">
              <input type="hidden" name="_intent" value="goal" />
              <Label htmlFor="daily_step_goal">Daily step goal</Label>
              <Input
                id="daily_step_goal"
                name="daily_step_goal"
                type="number"
                min={1}
                defaultValue={stepGoal}
                required
              />
              <Button type="submit" size="sm" variant="outline">
                Save goal
              </Button>
            </form>
          </div>
        )}
        {state?.error && <p className="text-sm text-destructive dark:text-red-400">{state.error}</p>}
      </CardContent>
    </Card>
  );
}

function LogWorkoutCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<ActivityActionState, FormData>(
    async (prev, formData) => {
      const result = await logWorkoutAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
        queryClient.invalidateQueries({ queryKey: [WEEKLY_MINUTES_KEY, patientId] });
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a workout</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="activity_name">Activity</Label>
            <Select id="activity_name" name="activity_name" defaultValue={COMMON_ACTIVITY_NAMES[0]} required>
              {COMMON_ACTIVITY_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="duration_minutes">Duration (min)</Label>
            <Input id="duration_minutes" name="duration_minutes" type="number" min={1} placeholder="30" required />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Logging…" : "Log workout"}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive dark:text-red-400">{state.error}</p>}
        {state?.success && <p className="mt-2 text-sm text-brand-green dark:text-brand-green-bright">Logged.</p>}
      </CardContent>
    </Card>
  );
}

function entrySummary(entry: ActivityEntry): string {
  if (entry.entry_type === "steps") {
    return `${(entry.step_count ?? 0).toLocaleString()} steps`;
  }
  const mins = entry.duration_minutes ?? 0;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  const duration = hrs > 0 ? `${hrs}hr${rest ? ` ${rest}min` : ""}` : `${mins}min`;
  return `${duration} · ${entry.activity_name}`;
}

const StepsIcon = SEMANTIC_ICON.steps;

const INTENSITY_LABEL: Record<ReturnType<typeof classifyActivity>["intensity"], string> = {
  light: "Light",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

function EntryRow({
  entry,
  patientId,
  weightKg,
}: {
  entry: ActivityEntry;
  patientId: string;
  weightKg: number | null;
}) {
  const queryClient = useQueryClient();
  const [favorite, setFavorite] = useState(entry.is_favorite);

  const workoutDetail =
    entry.entry_type === "workout" && entry.activity_name && entry.duration_minutes != null
      ? classifyActivity(entry.activity_name)
      : null;
  const calories =
    workoutDetail && weightKg ? caloriesBurned(workoutDetail.met, weightKg, entry.duration_minutes as number) : null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-soft-sage dark:bg-brand-green/20">
          <StepsIcon className="h-4 w-4 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{entrySummary(entry)}</p>
          {entry.entry_type === "steps" && entry.step_count != null && (
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Logged for the day</p>
          )}
          {workoutDetail && (
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              {INTENSITY_LABEL[workoutDetail.intensity]} intensity
              {calories != null ? ` · ~${calories.toLocaleString()} kcal` : ""}
            </p>
          )}
        </div>
      </div>
      {entry.entry_type === "workout" && (
        <button
          type="button"
          aria-label={favorite ? "Unfavorite" : "Favorite"}
          onClick={async () => {
            const next = !favorite;
            setFavorite(next);
            await toggleActivityFavoriteAction(entry.id, next);
            queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
          }}
          className="text-lg"
        >
          {favorite ? "❤️" : "🤍"}
        </button>
      )}
    </li>
  );
}
