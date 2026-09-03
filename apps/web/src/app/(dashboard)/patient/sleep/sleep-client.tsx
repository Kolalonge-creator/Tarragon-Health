"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSleepGoal, useSleepLogEntries } from "@/lib/queries/sleep";
import { setSleepGoalAction, logSleepEntryAction, type SleepActionState } from "./actions";
import { DAYTIME_SLEEPINESS_LABELS } from "@/lib/validation/sleep";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LifestyleBarrierPicker } from "@/components/lifestyle-barrier-picker";

import { formatPatientDate } from "@/lib/format-date";
const GOAL_KEY = "sleep-goal";
const ENTRIES_KEY = "sleep-log-entries";

export function SleepClient({ patientId }: { patientId: string }) {
  const goal = useSleepGoal(patientId);
  const entries = useSleepLogEntries(patientId);

  return (
    <div className="space-y-6">
      <GoalCard patientId={patientId} goal={goal.data} />
      <LogCard patientId={patientId} />

      <LifestyleBarrierPicker domain="sleep" />

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!entries.isLoading && (entries.data?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing logged yet.</p>
          )}
          <ul className="space-y-2">
            {(entries.data ?? []).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-sm font-medium text-charcoal-ink">
                  {formatPatientDate(entry.logged_on, { month: "long", day: "numeric" })}:{" "}
                  {entry.duration_hours}h
                  {entry.quality_rating != null && ` · quality ${entry.quality_rating}/5`}
                </p>
                {entry.daytime_sleepiness != null && (
                  <p className="text-xs text-charcoal-ink/60">
                    Daytime sleepiness: {DAYTIME_SLEEPINESS_LABELS[entry.daytime_sleepiness]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function GoalCard({
  patientId,
  goal,
}: {
  patientId: string;
  goal: ReturnType<typeof useSleepGoal>["data"];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!goal);
  const [state, formAction, pending] = useActionState<SleepActionState, FormData>(
    async (prev, formData) => {
      const result = await setSleepGoalAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [GOAL_KEY, patientId] });
        setEditing(false);
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Your sleep goal</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? "Close" : goal ? "Update" : "Set a goal"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {goal && !editing && (
          <p className="text-sm text-charcoal-ink">
            {goal.target_duration_hours != null && `${goal.target_duration_hours}h target`}
            {goal.target_bedtime && ` · bedtime ${goal.target_bedtime.slice(0, 5)}`}
            {goal.target_waketime && ` · wake ${goal.target_waketime.slice(0, 5)}`}
          </p>
        )}
        {editing && (
          <form action={formAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="target_duration_hours">Target hours</Label>
              <Input
                id="target_duration_hours"
                name="target_duration_hours"
                type="number"
                min={0}
                max={24}
                step={0.5}
                defaultValue={goal?.target_duration_hours ?? undefined}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="target_bedtime">Bedtime</Label>
              <Input id="target_bedtime" name="target_bedtime" type="time" defaultValue={goal?.target_bedtime?.slice(0, 5) ?? undefined} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="target_waketime">Wake time</Label>
              <Input id="target_waketime" name="target_waketime" type="time" defaultValue={goal?.target_waketime?.slice(0, 5) ?? undefined} />
            </div>
            <Button type="submit" disabled={pending} className="sm:col-span-3">
              {pending ? "Saving…" : "Save goal"}
            </Button>
          </form>
        )}
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}

function LogCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<SleepActionState, FormData>(
    async (prev, formData) => {
      const result = await logSleepEntryAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log last night</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="duration_hours">Hours slept</Label>
            <Input id="duration_hours" name="duration_hours" type="number" min={0} max={24} step={0.5} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="quality_rating">Quality (1-5)</Label>
            <Input id="quality_rating" name="quality_rating" type="number" min={1} max={5} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="bedtime">Bedtime</Label>
            <Input id="bedtime" name="bedtime" type="time" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="waketime">Wake time</Label>
            <Input id="waketime" name="waketime" type="time" />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="daytime_sleepiness">How likely are you to doze off during the day?</Label>
            <Select id="daytime_sleepiness" name="daytime_sleepiness" defaultValue="">
              <option value="">Not sure</option>
              {Object.entries(DAYTIME_SLEEPINESS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
        {state?.success && <p className="mt-2 text-sm text-brand-green">Logged.</p>}
      </CardContent>
    </Card>
  );
}
