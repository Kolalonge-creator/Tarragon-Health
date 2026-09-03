"use client";

import { useState } from "react";
import { useCareTasks, useCompleteCareTask, type CareTask } from "@/lib/queries/care-tasks";
import { useCarePlanGoals, useProposeCarePlanGoal } from "@/lib/queries/care-plan-goals";
import { useCarePlans, type CarePlan } from "@/lib/queries/care-plans";
import { groupCareTasksByBucket } from "@/lib/rules/care-task-buckets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { UpgradePrompt } from "@/components/upgrade-prompt";

function humanize(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/**
 * §3.15: "Do not create four completely separate care plans that overwhelm
 * the patient... Condition-specific protocols feeding into One unified
 * patient care plan." This used to be its own "Care plan" card sitting next
 * to a separate "My care plan" tasks card — two cards read as two plans.
 * Folded in here as the top section of ONE card so a multimorbid patient
 * sees one coordinated plan with several condition threads, not several
 * plans, while the goals/tasks below are already unified by being
 * patient-scoped rather than per-condition.
 */
function ConditionsOverview({ plans }: { plans: CarePlan[] }) {
  if (plans.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No care plan yet. Your doctor will assign one after reviewing your health data.
      </p>
    );
  }

  return (
    <div>
      {plans.length > 1 && (
        <p className="mb-2 text-xs text-charcoal-ink/60">
          Managed together as one coordinated plan: {plans.map((p) => humanize(p.condition)).join(", ")}.
        </p>
      )}
      <ul className="divide-y divide-charcoal-ink/10">
        {plans.map((plan) => {
          const targetRanges = (plan.target_ranges ?? {}) as Record<string, unknown>;
          const targetRangeEntries = Object.entries(targetRanges);

          return (
            <li key={plan.id} className="space-y-1 py-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-charcoal-ink">{humanize(plan.condition)}</p>
                <Badge variant="green">Active</Badge>
              </div>
              <p className="text-xs text-charcoal-ink/60">
                {plan.assigned_clinician?.full_name
                  ? `Managed by ${plan.assigned_clinician.full_name}`
                  : "Not yet assigned to a doctor"}
              </p>
              {targetRangeEntries.length > 0 && (
                <p className="text-xs text-charcoal-ink/60">
                  {targetRangeEntries.map(([key, value]) => `${humanize(key)}: ${value}`).join("; ")}
                </p>
              )}
              {plan.notes && <p className="text-xs text-charcoal-ink/60">{plan.notes}</p>}
              {!plan.hasScheduledReview && <UpgradePrompt feature="multi_condition_review" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TaskRow({ task, patientId }: { task: CareTask; patientId: string }) {
  const complete = useCompleteCareTask(patientId);
  const [showUnable, setShowUnable] = useState(false);
  const [reason, setReason] = useState("");
  const due = formatDue(task.due_at);

  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{task.title}</p>
        {task.status === "missed" && <Badge variant="amber">Overdue</Badge>}
        {due && <span className="text-xs text-charcoal-ink/60">Due {due}</span>}
      </div>
      {task.description && <p className="text-xs text-charcoal-ink/60">{task.description}</p>}
      {!showUnable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={complete.isPending}
            onClick={() => complete.mutate({ taskId: task.id, status: "completed" })}
          >
            {complete.isPending ? "Saving…" : "Done"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowUnable(true)}>
            Can&apos;t do this
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="What's stopping you? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate({ taskId: task.id, status: "unable_to_complete", unableReason: reason })
            }
          >
            Tell my care team
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowUnable(false)}>
            Cancel
          </Button>
        </div>
      )}
      {complete.isError && (
        <p className="text-xs text-red-600">{(complete.error as Error)?.message ?? "Could not update this task."}</p>
      )}
    </li>
  );
}

function TaskSection({
  title,
  tasks,
  patientId,
}: {
  title: string;
  tasks: CareTask[];
  patientId: string;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">{title}</p>
      <ul className="divide-y divide-charcoal-ink/10">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} patientId={patientId} />
        ))}
      </ul>
    </div>
  );
}

function ProposeGoalForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const [description, setDescription] = useState("");
  const propose = useProposeCarePlanGoal(patientId);

  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = description.trim();
        if (!trimmed) return;
        propose.mutate(
          { organisationId, description: trimmed },
          { onSuccess: () => setDescription("") },
        );
      }}
    >
      <Input
        placeholder="Set your own goal, e.g. Walk 5,000 steps a day"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="max-w-sm"
      />
      <Button type="submit" size="sm" disabled={propose.isPending || !description.trim()}>
        {propose.isPending ? "Saving…" : "Add goal"}
      </Button>
      {propose.isError && (
        <p className="w-full text-xs text-red-600">
          {(propose.error as Error)?.message ?? "Could not add that goal."}
        </p>
      )}
    </form>
  );
}

/**
 * "Your Care Plan" — one unified surface across every active condition
 * (§3.15), covering: the condition(s) it manages (§3.3, folded in from the
 * old separate CarePlanDisplay), Today/This week/Upcoming/Overdue tasks
 * (§3.11), and goals with a way to propose one (§3.16). Tasks come from
 * care_tasks, generated automatically for a chronic programme (§3.5) or
 * added by a clinician; completing one is always via
 * public.complete_care_task() (see useCompleteCareTask), never a raw update.
 */
export function MyCarePlanTasks({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: plans } = useCarePlans(patientId);
  const { data: tasks, isLoading, isError } = useCareTasks(patientId);
  const { data: goals } = useCarePlanGoals(patientId);

  const buckets = groupCareTasksByBucket(tasks ?? [], new Date());
  const visibleGoals = (goals ?? []).filter((g) => g.status === "open" || g.status === "proposed");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your care plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConditionsOverview plans={plans ?? []} />

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your care plan tasks.</p>}
        {!isLoading && !isError && (tasks ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No tasks yet. Your care team will add these as your plan is set up.
          </p>
        )}

        <TaskSection title="Overdue" tasks={buckets.overdue} patientId={patientId} />
        <TaskSection title="Today" tasks={buckets.today} patientId={patientId} />
        <TaskSection title="This week" tasks={buckets.thisWeek} patientId={patientId} />
        <TaskSection title="Upcoming" tasks={buckets.upcoming} patientId={patientId} />

        {visibleGoals.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
              Your goals
            </p>
            <ul className="space-y-1.5">
              {visibleGoals.map((goal) => (
                <li key={goal.id} className="flex items-center gap-2 text-sm text-charcoal-ink">
                  {goal.status === "proposed" ? (
                    <Badge variant="blue">Pending review</Badge>
                  ) : (
                    <Badge variant="green">Active</Badge>
                  )}
                  {goal.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        {organisationId && <ProposeGoalForm patientId={patientId} organisationId={organisationId} />}
      </CardContent>
    </Card>
  );
}
