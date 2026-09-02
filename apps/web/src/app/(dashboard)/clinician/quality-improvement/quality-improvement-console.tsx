"use client";

import { useState } from "react";
import type { Enums } from "@tarragon/shared";
import {
  useQualityImprovementCycles,
  useCreateQualityImprovementCycle,
  useStartQualityImprovementIntervention,
  useRemeasureQualityImprovementCycle,
  type QualityImprovementCycle,
} from "@/lib/queries/quality-improvement";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type CarePlanCondition = Enums<"care_plan_condition">;

const CONDITIONS: CarePlanCondition[] = [
  "diabetes",
  "hypertension",
  "obesity",
  "ckd",
  "cardiovascular",
  "asthma",
  "copd",
  "heart_failure",
  "other",
];

const STATUS_BADGE: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  open: { variant: "amber", label: "Gap identified" },
  intervention_active: { variant: "blue", label: "Intervention active" },
  remeasured: { variant: "blue", label: "Re-measured" },
  closed: { variant: "green", label: "Closed" },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function CycleCard({ cycle }: { cycle: QualityImprovementCycle }) {
  const startIntervention = useStartQualityImprovementIntervention();
  const remeasure = useRemeasureQualityImprovementCycle();
  const [intervention, setIntervention] = useState("");
  const [remeasureValue, setRemeasureValue] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  const badge = STATUS_BADGE[cycle.status] ?? STATUS_BADGE.open;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{cycle.metric_source}</CardTitle>
            <CardDescription>
              {cycle.condition ? `${cycle.condition} · ` : ""}
              Baseline {cycle.baseline_value ?? "—"} on {cycle.baseline_measured_at}
              {cycle.target_value != null && ` · target ${cycle.target_value}`}
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80">{cycle.gap_description}</p>

        {cycle.intervention && (
          <p className="text-sm text-charcoal-ink/80">
            <span className="font-medium">Intervention: </span>
            {cycle.intervention}
            {cycle.intervention_started_at && ` (started ${cycle.intervention_started_at})`}
          </p>
        )}

        {(cycle.status === "remeasured" || cycle.status === "closed") && (
          <p className="text-sm text-charcoal-ink/80">
            <span className="font-medium">Re-measured: </span>
            {cycle.remeasure_value} on {cycle.remeasured_at}
            {cycle.outcome_note && ` — ${cycle.outcome_note}`}
          </p>
        )}

        {cycle.status === "open" && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            <Label>Intervention</Label>
            <Input
              placeholder="What's being done about this gap"
              value={intervention}
              onChange={(e) => setIntervention(e.target.value)}
            />
            {startIntervention.isError && (
              <p className="text-sm text-red-600">{(startIntervention.error as Error).message}</p>
            )}
            <Button
              size="sm"
              disabled={intervention.trim().length === 0 || startIntervention.isPending}
              onClick={() =>
                startIntervention.mutate({
                  cycleId: cycle.id,
                  intervention: intervention.trim(),
                  interventionStartedAt: todayIso(),
                })
              }
            >
              Start intervention
            </Button>
          </div>
        )}

        {cycle.status === "intervention_active" && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            <Label>Re-measured value</Label>
            <Input
              type="number"
              value={remeasureValue}
              onChange={(e) => setRemeasureValue(e.target.value)}
            />
            <Label>Outcome note</Label>
            <Textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} />
            {remeasure.isError && <p className="text-sm text-red-600">{(remeasure.error as Error).message}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={remeasureValue.trim().length === 0 || remeasure.isPending}
                onClick={() =>
                  remeasure.mutate({
                    cycleId: cycle.id,
                    remeasureValue: Number(remeasureValue),
                    remeasuredAt: todayIso(),
                    outcomeNote: outcomeNote.trim(),
                    close: false,
                  })
                }
              >
                Save re-measure
              </Button>
              <Button
                size="sm"
                disabled={remeasureValue.trim().length === 0 || remeasure.isPending}
                onClick={() =>
                  remeasure.mutate({
                    cycleId: cycle.id,
                    remeasureValue: Number(remeasureValue),
                    remeasuredAt: todayIso(),
                    outcomeNote: outcomeNote.trim(),
                    close: true,
                  })
                }
              >
                Re-measure & close
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The Measure -> Identify gap -> Intervention -> Re-measure loop (docs spec
 * §88.13). A cycle is opened once a quality dashboard (diabetes/
 * hypertension/obesity-quality) shows a metric below target.
 */
export function QualityImprovementConsole() {
  const { data: cycles, isLoading, isError } = useQualityImprovementCycles();
  const create = useCreateQualityImprovementCycle();

  const [condition, setCondition] = useState<CarePlanCondition | "">("");
  const [metricSource, setMetricSource] = useState("");
  const [baselineValue, setBaselineValue] = useState("");
  const [gapDescription, setGapDescription] = useState("");
  const [targetValue, setTargetValue] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !cycles) return <p className="text-sm text-red-600">Could not load quality-improvement cycles.</p>;

  const open = cycles.filter((c) => c.status !== "closed");
  const closed = cycles.filter((c) => c.status === "closed");
  const canSubmit = metricSource.trim().length > 0 && gapDescription.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Open a quality-improvement cycle</CardTitle>
          <CardDescription>
            Measure → Identify gap → Intervention → Re-measure. Start one when a quality dashboard
            (Diabetes/Hypertension/Obesity quality) shows a metric below target.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qi-condition">Condition (optional)</Label>
              <Select
                id="qi-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as CarePlanCondition | "")}
              >
                <option value="">Not condition-specific</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qi-metric">Metric</Label>
              <Input
                id="qi-metric"
                placeholder="e.g. hypertension_quality_metrics.at_target"
                value={metricSource}
                onChange={(e) => setMetricSource(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qi-baseline">Baseline value</Label>
              <Input id="qi-baseline" type="number" value={baselineValue} onChange={(e) => setBaselineValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qi-target">Target value (optional)</Label>
              <Input id="qi-target" type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qi-gap">Gap description</Label>
            <Textarea id="qi-gap" value={gapDescription} onChange={(e) => setGapDescription(e.target.value)} />
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  condition: condition || undefined,
                  metricSource: metricSource.trim(),
                  baselineValue: baselineValue.trim() ? Number(baselineValue) : undefined,
                  baselineMeasuredAt: todayIso(),
                  gapDescription: gapDescription.trim(),
                  targetValue: targetValue.trim() ? Number(targetValue) : undefined,
                },
                {
                  onSuccess: () => {
                    setCondition("");
                    setMetricSource("");
                    setBaselineValue("");
                    setGapDescription("");
                    setTargetValue("");
                  },
                }
              )
            }
          >
            {create.isPending ? "Saving…" : "Open cycle"}
          </Button>
        </CardContent>
      </Card>

      {open.length === 0 && closed.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">No quality-improvement cycles yet.</p>
      )}

      {open.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">Open cycles</h3>
          {open.map((c) => (
            <CycleCard key={c.id} cycle={c} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">Closed cycles</h3>
          {closed.map((c) => (
            <CycleCard key={c.id} cycle={c} />
          ))}
        </div>
      )}
    </div>
  );
}
