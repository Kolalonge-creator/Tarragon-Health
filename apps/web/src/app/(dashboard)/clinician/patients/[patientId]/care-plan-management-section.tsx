"use client";

import { useState } from "react";
import {
  useCarePlansForManagement,
  useUpdateCarePlanStatus,
  useCarePlanGoals,
  useAddCarePlanGoal,
  useUpdateCarePlanGoalStatus,
  useCarePlanInterventions,
  useAddCarePlanIntervention,
  useRemoveCarePlanIntervention,
  useCarePlanVersions,
  type CarePlanRow,
} from "@/lib/queries/care-plan-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STATUS_BADGE: Record<CarePlanRow["status"], { label: string; variant: BadgeProps["variant"] }> = {
  draft: { label: "Draft — needs approval", variant: "amber" },
  active: { label: "Active", variant: "green" },
  paused: { label: "Paused", variant: "blue" },
  completed: { label: "Completed", variant: "grey" },
  discharged: { label: "Discharged", variant: "grey" },
  cancelled: { label: "Cancelled", variant: "grey" },
  declined: { label: "Declined", variant: "red" },
  transferred: { label: "Transferred", variant: "grey" },
};

function formatCondition(condition: string): string {
  return condition.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Care Team / Provider Workspace §5.14 — approve / modify / goals /
 * interventions / pause / discharge, every change versioned automatically
 * by care_plans_snapshot_version (20260827205255). This is the first
 * clinician-facing editor care_plans has ever had: previously the only
 * write path was accepting a recommendation into a 'draft' row, with no way
 * to then approve, adjust, or close it out.
 */
export function CarePlanManagementSection({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: plans, isLoading } = useCarePlansForManagement(patientId);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!plans || plans.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Care plans</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            No care plan on file yet — accept a recommendation from Recommendations to start one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {plans.map((plan) => (
        <CarePlanCard key={plan.id} plan={plan} organisationId={organisationId} />
      ))}
    </div>
  );
}

function CarePlanCard({ plan, organisationId }: { plan: CarePlanRow; organisationId: string }) {
  const updateStatus = useUpdateCarePlanStatus();
  const [showHistory, setShowHistory] = useState(false);

  const nextActions: { label: string; status: CarePlanRow["status"] }[] =
    plan.status === "draft"
      ? [{ label: "Approve", status: "active" }]
      : plan.status === "active"
        ? [
            { label: "Pause", status: "paused" },
            { label: "Discharge", status: "discharged" },
          ]
        : plan.status === "paused"
          ? [
              { label: "Resume", status: "active" },
              { label: "Discharge", status: "discharged" },
            ]
          : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{formatCondition(plan.condition)}</CardTitle>
          <Badge variant={STATUS_BADGE[plan.status].variant}>{STATUS_BADGE[plan.status].label}</Badge>
        </div>
        {plan.notes && <CardDescription>{plan.notes}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {nextActions.map((action) => (
            <Button
              key={action.status}
              type="button"
              variant="outline"
              size="sm"
              disabled={updateStatus.isPending}
              onClick={() =>
                updateStatus.mutate({ carePlanId: plan.id, patientId: plan.patient_id, status: action.status })
              }
            >
              {action.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-charcoal-ink/60"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Hide" : "Show"} version history
          </Button>
        </div>

        {showHistory && <VersionHistory carePlanId={plan.id} />}

        <GoalsList carePlanId={plan.id} organisationId={organisationId} patientId={plan.patient_id} />
        <InterventionsList carePlanId={plan.id} organisationId={organisationId} patientId={plan.patient_id} />
      </CardContent>
    </Card>
  );
}

function GoalsList({
  carePlanId,
  organisationId,
  patientId,
}: {
  carePlanId: string;
  organisationId: string;
  patientId: string;
}) {
  const { data: goals } = useCarePlanGoals(carePlanId);
  const addGoal = useAddCarePlanGoal();
  const updateStatus = useUpdateCarePlanGoalStatus();
  const [newGoal, setNewGoal] = useState("");

  const open = (goals ?? []).filter((g) => g.status === "open");
  const resolved = (goals ?? []).filter((g) => g.status !== "open");

  return (
    <div className="space-y-1.5 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Goals</p>
      {open.length === 0 && resolved.length === 0 && (
        <p className="text-xs text-charcoal-ink/50">No goals set yet.</p>
      )}
      {open.length > 0 && (
        <ul className="space-y-1">
          {open.map((goal) => (
            <li key={goal.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-charcoal-ink">{goal.description}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="text-xs text-brand-green hover:underline"
                  onClick={() => updateStatus.mutate({ goalId: goal.id, carePlanId, status: "achieved" })}
                >
                  Achieved
                </button>
                <button
                  type="button"
                  className="text-xs text-charcoal-ink/40 hover:text-red-600"
                  onClick={() => updateStatus.mutate({ goalId: goal.id, carePlanId, status: "abandoned" })}
                >
                  Abandon
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <ul className="space-y-0.5">
          {resolved.map((goal) => (
            <li key={goal.id} className="text-xs text-charcoal-ink/40 line-through">
              {goal.description} ({goal.status})
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-1">
        <Input
          value={newGoal}
          onChange={(event) => setNewGoal(event.target.value)}
          placeholder="Add a goal, e.g. HbA1c under 7% by next review"
          className="h-8 text-xs"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={addGoal.isPending || !newGoal.trim()}
          onClick={() =>
            addGoal.mutate(
              { carePlanId, organisationId, patientId, description: newGoal.trim() },
              { onSuccess: () => setNewGoal("") },
            )
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function InterventionsList({
  carePlanId,
  organisationId,
  patientId,
}: {
  carePlanId: string;
  organisationId: string;
  patientId: string;
}) {
  const { data: interventions } = useCarePlanInterventions(carePlanId);
  const addIntervention = useAddCarePlanIntervention();
  const removeIntervention = useRemoveCarePlanIntervention();
  const [newDescription, setNewDescription] = useState("");
  const [newFrequency, setNewFrequency] = useState("");

  const active = (interventions ?? []).filter((i) => i.status === "active");

  return (
    <div className="space-y-1.5 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Interventions</p>
      {active.length === 0 && <p className="text-xs text-charcoal-ink/50">No interventions set yet.</p>}
      {active.length > 0 && (
        <ul className="space-y-1">
          {active.map((intervention) => (
            <li key={intervention.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-charcoal-ink">
                {intervention.description}
                {intervention.frequency && (
                  <span className="text-charcoal-ink/50"> · {intervention.frequency}</span>
                )}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-charcoal-ink/40 hover:text-red-600"
                onClick={() => removeIntervention.mutate({ interventionId: intervention.id, carePlanId })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Input
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
          placeholder="e.g. Home BP monitoring"
          className="h-8 flex-1 text-xs"
        />
        <Input
          value={newFrequency}
          onChange={(event) => setNewFrequency(event.target.value)}
          placeholder="Frequency (optional)"
          className="h-8 w-40 text-xs"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={addIntervention.isPending || !newDescription.trim()}
          onClick={() =>
            addIntervention.mutate(
              {
                carePlanId,
                organisationId,
                patientId,
                description: newDescription.trim(),
                frequency: newFrequency.trim() || null,
              },
              {
                onSuccess: () => {
                  setNewDescription("");
                  setNewFrequency("");
                },
              },
            )
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function VersionHistory({ carePlanId }: { carePlanId: string }) {
  const { data: versions, isLoading } = useCarePlanVersions(carePlanId);

  if (isLoading) return <p className="text-xs text-charcoal-ink/50">Loading history…</p>;
  if (!versions || versions.length === 0) {
    return <p className="text-xs text-charcoal-ink/50">No prior versions — this plan hasn&apos;t been edited yet.</p>;
  }

  return (
    <ul className="space-y-1 rounded-md bg-charcoal-ink/5 p-2 text-xs">
      {versions.map((version) => {
        const snapshot = version.snapshot as { status?: string; notes?: string | null };
        return (
          <li key={version.id} className="text-charcoal-ink/70">
            v{version.version_number} · {new Date(version.created_at).toLocaleString()} · was{" "}
            <span className="font-medium">{snapshot.status ?? "unknown"}</span>
          </li>
        );
      })}
    </ul>
  );
}
