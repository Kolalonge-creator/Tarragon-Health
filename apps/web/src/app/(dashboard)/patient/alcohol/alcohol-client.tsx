"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAlcoholGoal, useAlcoholConsumptionLogs, drinksThisWeek } from "@/lib/queries/alcohol";
import { setAlcoholGoalAction, logAlcoholConsumptionAction, type AlcoholActionState } from "./actions";
import { ALCOHOL_CONTEXTS, ALCOHOL_CONTEXT_LABELS } from "@/lib/validation/alcohol";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LifestyleBarrierPicker } from "@/components/lifestyle-barrier-picker";

import { formatPatientDate } from "@/lib/format-date";
const GOAL_KEY = "alcohol-goal";
const LOGS_KEY = "alcohol-consumption-logs";

export function AlcoholClient({ patientId }: { patientId: string }) {
  const goal = useAlcoholGoal(patientId);
  const logs = useAlcoholConsumptionLogs(patientId);
  const weekTotal = useMemo(() => drinksThisWeek(logs.data ?? []), [logs.data]);

  return (
    <div className="space-y-6">
      <GoalCard patientId={patientId} goal={goal.data} weekTotal={weekTotal} />
      <LogCard patientId={patientId} />

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm font-medium text-charcoal-ink">Not sure where you stand?</p>
            <p className="text-xs text-charcoal-ink/60">Retake the AUDIT-C screen, or read up on cutting back.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/patient/health-check" className="text-sm font-medium text-brand-green hover:underline">
              Screening
            </Link>
            <Link href="/patient/learn" className="text-sm font-medium text-brand-green hover:underline">
              Learn
            </Link>
          </div>
        </CardContent>
      </Card>

      <LifestyleBarrierPicker domain="alcohol" />

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!logs.isLoading && (logs.data?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing logged yet.</p>
          )}
          <ul className="space-y-2">
            {(logs.data ?? []).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-sm font-medium text-charcoal-ink">
                  {formatPatientDate(entry.logged_on, { month: "long", day: "numeric" })}:{" "}
                  {entry.drinks_count} drink{entry.drinks_count === 1 ? "" : "s"}
                  {entry.context && ` (${ALCOHOL_CONTEXT_LABELS[entry.context as keyof typeof ALCOHOL_CONTEXT_LABELS]})`}
                </p>
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
  weekTotal,
}: {
  patientId: string;
  goal: ReturnType<typeof useAlcoholGoal>["data"];
  weekTotal: number;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!goal);
  const [state, formAction, pending] = useActionState<AlcoholActionState, FormData>(
    async (prev, formData) => {
      const result = await setAlcoholGoalAction(prev, formData);
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
        <CardTitle>Weekly goal</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? "Close" : goal ? "Update" : "Set a goal"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {goal?.target_drinks_per_week != null && (
          <p className="text-sm text-charcoal-ink">
            {weekTotal} of a {goal.target_drinks_per_week} drinks/week goal so far this week
          </p>
        )}
        {!goal && !editing && (
          <p className="text-sm text-charcoal-ink/60">No goal set yet. Set one whenever you&apos;re ready.</p>
        )}
        {editing && (
          <form action={formAction} className="flex items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="target_drinks_per_week">Target drinks per week</Label>
              <Input
                id="target_drinks_per_week"
                name="target_drinks_per_week"
                type="number"
                min={0}
                defaultValue={goal?.target_drinks_per_week ?? undefined}
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
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
  const [state, formAction, pending] = useActionState<AlcoholActionState, FormData>(
    async (prev, formData) => {
      const result = await logAlcoholConsumptionAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [LOGS_KEY, patientId] });
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log today&apos;s drinks</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="drinks_count">Standard drinks</Label>
            <Input id="drinks_count" name="drinks_count" type="number" min={0} defaultValue={0} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="context">Context</Label>
            <Select id="context" name="context" defaultValue="">
              <option value="">Not specified</option>
              {ALCOHOL_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {ALCOHOL_CONTEXT_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
        {state?.success && <p className="mt-2 text-sm text-brand-green">Logged.</p>}
      </CardContent>
    </Card>
  );
}
