"use client";

import { useState } from "react";
import { useCareTasks, useCompleteCareTask, type CareTask } from "@/lib/queries/care-tasks";
import { useCarePlanGoals, useProposeCarePlanGoal } from "@/lib/queries/care-plan-goals";
import { groupCareTasksByBucket } from "@/lib/rules/care-task-buckets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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
 * "My Care Plan" — spec §3.11's patient dashboard: Today / This week /
 * Upcoming, plus the patient's goals and a way to propose their own (§3.16).
 * Tasks come from care_tasks, generated automatically for a chronic
 * programme (§3.5) or added by a clinician; completing one is always via
 * public.complete_care_task() (see useCompleteCareTask), never a raw update.
 */
export function MyCarePlanTasks({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: tasks, isLoading, isError } = useCareTasks(patientId);
  const { data: goals } = useCarePlanGoals(patientId);

  const buckets = groupCareTasksByBucket(tasks ?? [], new Date());
  const visibleGoals = (goals ?? []).filter((g) => g.status === "active" || g.status === "proposed");

  return (
    <Card>
      <CardHeader>
        <CardTitle>My care plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your care plan tasks.</p>}
        {!isLoading && !isError && (tasks ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No tasks yet — your care team will add these as your plan is set up.
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
