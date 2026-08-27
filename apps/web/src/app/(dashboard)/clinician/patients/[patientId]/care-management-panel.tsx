"use client";

import { useState } from "react";
import {
  useActiveChronicProgrammes,
  useChronicEnrolments,
  useEnrolChronicProgramme,
  useWithdrawChronicEnrolment,
} from "@/lib/queries/chronic-programmes";
import { useAllCarePlans, useUpdateCarePlanStatus } from "@/lib/queries/care-plans";
import { useCareTasks, useCreateCareTask, useCancelCareTask } from "@/lib/queries/care-tasks";
import { useCarePlanGoals, useUpdateCarePlanGoal } from "@/lib/queries/care-plan-goals";
import { computeCareTaskSummary } from "@/lib/rules/care-task-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Enums } from "@tarragon/shared";

const CARE_PLAN_STATUSES: Enums<"care_plan_status">[] = [
  "draft",
  "active",
  "paused",
  "completed",
  "transferred",
  "declined",
  "discharged",
  "cancelled",
];

const OPEN_TASK_STATUSES = new Set(["not_started", "scheduled", "in_progress", "missed"]);

/**
 * §3.4: "A clinician should also be able to manually enrol a patient." This
 * was the one hook in chronic-programmes.ts with zero callers anywhere in
 * the product (accepting a care-plan recommendation writes straight to
 * care_plans, bypassing chronic_programme_enrolments entirely) — activating
 * a care_plans row now auto-enrols via a DB trigger, but a clinician needs a
 * way to enrol independent of that, and to see/withdraw what's enrolled.
 */
function ProgrammeEnrolments({ patientId }: { patientId: string }) {
  const { data: programmes } = useActiveChronicProgrammes();
  const { data: enrolments } = useChronicEnrolments(patientId);
  const enrol = useEnrolChronicProgramme();
  const withdraw = useWithdrawChronicEnrolment();

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
        Chronic programmes
      </p>
      <ul className="space-y-1.5">
        {(programmes ?? []).map((programme) => {
          const enrolment = (enrolments ?? []).find((e) => e.programme_id === programme.id);
          return (
            <li key={programme.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-charcoal-ink">{programme.name}</span>
              {enrolment ? (
                <div className="flex items-center gap-2">
                  <Badge variant="green">Enrolled</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate({ enrolmentId: enrolment.id, patientId })}
                  >
                    Withdraw
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  disabled={enrol.isPending}
                  onClick={() => enrol.mutate({ patientId, programmeId: programme.id, source: "clinician" })}
                >
                  {enrol.isPending ? "Enrolling…" : "Enrol"}
                </Button>
              )}
            </li>
          );
        })}
        {(programmes ?? []).length === 0 && (
          <li className="text-sm text-charcoal-ink/60">No chronic programmes are live yet.</li>
        )}
      </ul>
      {enrol.isError && (
        <p className="mt-1 text-xs text-red-600">
          {(enrol.error as Error)?.message ?? "Could not enrol this patient."}
        </p>
      )}
    </div>
  );
}

/**
 * §3.19: a plan eventually reaches ongoing/completed/paused/transferred/
 * declined/discharged — "completed does not necessarily mean cured". Every
 * prior state is preserved in care_plan_versions the moment this write
 * lands, so changing status here never loses history.
 */
function CarePlanStatusPanel({ patientId }: { patientId: string }) {
  const { data: plans } = useAllCarePlans(patientId);
  const updateStatus = useUpdateCarePlanStatus(patientId);

  if (!plans || plans.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
        Care plans
      </p>
      <ul className="space-y-1.5">
        {plans.map((plan) => (
          <li key={plan.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-charcoal-ink">{plan.condition.replace("_", " ")}</span>
            <Select
              value={plan.status}
              disabled={updateStatus.isPending}
              onChange={(e) =>
                updateStatus.mutate({
                  carePlanId: plan.id,
                  status: e.target.value as Enums<"care_plan_status">,
                })
              }
              className="h-8 w-40 text-xs"
            >
              {CARE_PLAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      {updateStatus.isError && (
        <p className="mt-1 text-xs text-red-600">
          {(updateStatus.error as Error)?.message ?? "Could not update that plan's status."}
        </p>
      )}
    </div>
  );
}

/** §3.16/§3.17: a patient-proposed goal is a clinical decision to approve, modify, or decline. */
function GoalsPanel({ patientId }: { patientId: string }) {
  const { data: goals } = useCarePlanGoals(patientId);
  const update = useUpdateCarePlanGoal(patientId);
  const proposed = (goals ?? []).filter((g) => g.status === "proposed");
  const active = (goals ?? []).filter((g) => g.status === "active");

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">Goals</p>
      {proposed.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {proposed.map((goal) => (
            <li key={goal.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant="blue">Patient proposed</Badge> {goal.description}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => update.mutate({ goalId: goal.id, status: "active" })}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ goalId: goal.id, status: "abandoned" })}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1.5">
        {active.map((goal) => (
          <li key={goal.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <Badge variant="green">Active</Badge> {goal.description}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update.mutate({ goalId: goal.id, status: "achieved" })}
            >
              Mark achieved
            </Button>
          </li>
        ))}
        {active.length === 0 && proposed.length === 0 && (
          <li className="text-sm text-charcoal-ink/60">No goals recorded yet.</li>
        )}
      </ul>
    </div>
  );
}

/** §3.11's clinician view: "Care Plan Status: Completed 84%, Overdue: 2, High priority: 1". */
function TasksPanel({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: tasks } = useCareTasks(patientId);
  const cancel = useCancelCareTask(patientId);
  const create = useCreateCareTask(patientId);
  const [title, setTitle] = useState("");

  const summary = computeCareTaskSummary(tasks ?? []);
  const openTasks = (tasks ?? []).filter((t) => OPEN_TASK_STATUSES.has(t.status));

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
          Care plan status
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-charcoal-ink">
          <span>Completed: {summary.completedPct === null ? "—" : `${summary.completedPct}%`}</span>
          <span>Overdue: {summary.overdueCount}</span>
          <span>High priority: {summary.highPriorityOverdueCount}</span>
        </div>
      </div>
      <ul className="divide-y divide-charcoal-ink/10">
        {openTasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="flex items-center gap-2">
              {task.status === "missed" && <Badge variant="amber">Overdue</Badge>}
              {task.title}
              <span className="text-xs text-charcoal-ink/50">({task.owner_role.replace("_", " ")})</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => cancel.mutate(task.id)}>
              Cancel
            </Button>
          </li>
        ))}
        {openTasks.length === 0 && (
          <li className="py-1.5 text-sm text-charcoal-ink/60">Nothing outstanding right now.</li>
        )}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = title.trim();
          if (!trimmed) return;
          create.mutate({ organisationId, title: trimmed }, { onSuccess: () => setTitle("") });
        }}
      >
        <Input
          placeholder="Add a care-plan task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
          {create.isPending ? "Saving…" : "Add task"}
        </Button>
      </form>
    </div>
  );
}

export function CareManagementPanel({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  if (!organisationId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProgrammeEnrolments patientId={patientId} />
        <CarePlanStatusPanel patientId={patientId} />
        <GoalsPanel patientId={patientId} />
        <TasksPanel patientId={patientId} organisationId={organisationId} />
      </CardContent>
    </Card>
  );
}
