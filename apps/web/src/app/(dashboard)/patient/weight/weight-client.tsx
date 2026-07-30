"use client";

import { useActionState, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useVitalsTrend, useLatestWeightKg } from "@/lib/queries/vitals";
import { useWeightGoal } from "@/lib/queries/weight-goal";
import { setWeightGoalAction, type WeightGoalActionState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { SEMANTIC_ICON } from "@/lib/icons";

const WEIGHT_CONFIG: ChartConfig = {
  weight_kg: { label: "Weight (kg)", color: "var(--color-chart-glucose)" },
};

const RANGE_DAYS = { week: 7, month: 30, all: 3650 } as const;
type Range = keyof typeof RANGE_DAYS;

function formatDate(taken_at: string): string {
  return new Date(taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtKg(n: number): string {
  return `${n.toFixed(1)} kg`;
}

export function WeightClient({ patientId }: { patientId: string }) {
  const [range, setRange] = useState<Range>("month");
  const trend = useVitalsTrend(patientId, "weight", RANGE_DAYS[range]);
  const latest = useLatestWeightKg(patientId);
  const goal = useWeightGoal(patientId);

  const points = (trend.data ?? []).map((r) => ({ ...r, date: formatDate(r.taken_at) }));
  const currentWeight = latest.data?.weight_kg ?? null;

  // Must include the goal value, not just the data range — a goal well below
  // (or above) every logged reading would otherwise draw the ReferenceLine
  // outside the auto-scaled axis, making it invisible.
  const weights = points.map((p) => p.weight_kg).filter((w): w is number => w != null);
  const goalWeight = goal.data?.goal_weight_kg;
  const yValues = goalWeight != null ? [...weights, goalWeight] : weights;
  const yDomain: [number, number] | undefined =
    yValues.length > 0 ? [Math.min(...yValues) - 2, Math.max(...yValues) + 2] : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Weight</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? "default" : "outline"}
                onClick={() => setRange(r)}
              >
                {r === "week" ? "Week" : r === "month" ? "Month" : "All Time"}
              </Button>
            ))}
          </div>

          {trend.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {trend.isError && (
            <p className="text-sm text-red-600">Could not load your weight trend.</p>
          )}
          {!trend.isLoading && !trend.isError && points.length < 2 && (
            <p className="text-sm text-charcoal-ink/60">
              Not enough readings in this range yet — log weight from your vitals or lifestyle
              check-in to build the chart.
            </p>
          )}
          {points.length >= 2 && (
            <ChartContainer config={WEIGHT_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} domain={yDomain ?? ["dataMin - 2", "dataMax + 2"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {goal.data && (
                  <ReferenceLine
                    y={goal.data.goal_weight_kg}
                    stroke="var(--color-chart-systolic)"
                    strokeDasharray="4 4"
                    label={{ value: `Goal: ${fmtKg(goal.data.goal_weight_kg)}`, fontSize: 11, position: "insideTopLeft" }}
                  />
                )}
                <Line type="monotone" dataKey="weight_kg" stroke="var(--color-weight_kg)" dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <WeightGoalSection
        patientId={patientId}
        currentWeightKg={currentWeight}
        startingWeightKg={goal.data?.starting_weight_kg ?? null}
        goalWeightKg={goal.data?.goal_weight_kg ?? null}
        hasGoal={!!goal.data}
        isLoading={goal.isLoading}
      />
    </div>
  );
}

function WeightGoalSection({
  patientId,
  currentWeightKg,
  startingWeightKg,
  goalWeightKg,
  hasGoal,
  isLoading,
}: {
  patientId: string;
  currentWeightKg: number | null;
  startingWeightKg: number | null;
  goalWeightKg: number | null;
  hasGoal: boolean;
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  // Not seeded from `hasGoal` directly: that prop starts `false` before the
  // goal query resolves (async), and a useState initializer only runs once —
  // seeding from it here would permanently show the edit form on every fresh
  // load, even for a patient who already has a saved goal. Wait for the
  // query to settle before deciding there's nothing to edit.
  const [editingOverride, setEditingOverride] = useState<boolean | null>(null);
  const editing = editingOverride ?? (!isLoading && !hasGoal);
  const [state, formAction] = useActionState<WeightGoalActionState, FormData>(
    async (prev, formData) => {
      const result = await setWeightGoalAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["weight-goal", patientId] });
        setEditingOverride(false);
      }
      return result;
    },
    undefined,
  );

  const change =
    startingWeightKg != null && currentWeightKg != null ? startingWeightKg - currentWeightKg : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>My Weight Goal</CardTitle>
        {hasGoal && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditingOverride(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <form action={formAction} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="starting_weight_kg">Starting weight (kg)</Label>
                <Input
                  id="starting_weight_kg"
                  name="starting_weight_kg"
                  type="number"
                  step="0.1"
                  min={1}
                  defaultValue={startingWeightKg ?? currentWeightKg ?? undefined}
                  required
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="goal_weight_kg">Goal weight (kg)</Label>
                <Input
                  id="goal_weight_kg"
                  name="goal_weight_kg"
                  type="number"
                  step="0.1"
                  min={1}
                  defaultValue={goalWeightKg ?? undefined}
                  required
                />
              </div>
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex gap-2">
              <Button type="submit">Save goal</Button>
              {hasGoal && (
                <Button type="button" variant="outline" onClick={() => setEditingOverride(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 border-b border-charcoal-ink/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-charcoal-ink/50">Starting</p>
                <p className="font-heading text-xl font-semibold text-charcoal-ink">
                  {startingWeightKg != null ? fmtKg(startingWeightKg) : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-charcoal-ink/50">Goal</p>
                <p className="font-heading text-xl font-semibold text-charcoal-ink">
                  {goalWeightKg != null ? fmtKg(goalWeightKg) : "—"}
                </p>
              </div>
            </div>

            <p className="text-sm font-medium text-charcoal-ink">Overall progress</p>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                icon={SEMANTIC_ICON.weight}
                iconTint="ivory"
                label="Initial weight"
                value={startingWeightKg != null ? startingWeightKg.toFixed(1) : "—"}
                unit="kg"
              />
              <StatTile
                icon={SEMANTIC_ICON.weightTrend}
                iconTint="gold"
                label={change != null && change < 0 ? "Change so far (up)" : "Total lost so far"}
                value={change != null ? Math.abs(change).toFixed(1) : "—"}
                unit="kg"
                delta={
                  change != null
                    ? {
                        text: change > 0 ? "Down from your starting weight" : change < 0 ? "Up from your starting weight" : "Same as your starting weight",
                        direction: change > 0 ? "down" : change < 0 ? "up" : "flat",
                      }
                    : undefined
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
