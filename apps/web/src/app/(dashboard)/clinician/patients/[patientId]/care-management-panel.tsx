"use client";

import { useState } from "react";
import {
  useActiveChronicProgrammes,
  useChronicEnrolments,
  useEnrolChronicProgramme,
  useWithdrawChronicEnrolment,
} from "@/lib/queries/chronic-programmes";
import { useAllCarePlans, useCarePlanVersions, useUpdateCarePlanStatus } from "@/lib/queries/care-plans";
import { useCareTasks, useCreateCareTask, useCancelCareTask } from "@/lib/queries/care-tasks";
import { useCarePlanGoals, useUpdateCarePlanGoal } from "@/lib/queries/care-plan-goals";
import { useCarePlanDecisions, useCreateCarePlanDecision } from "@/lib/queries/care-plan-decisions";
import { computeCareTaskSummary } from "@/lib/rules/care-task-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
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
  // Withdrawing ends the patient's place on a doctor-supported programme and
  // stops its scheduled check-ins. It fired on one click, and a failure was
  // rendered nowhere at all, so a withdrawal that silently did not happen
  // looked exactly like one that did.
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<
    { enrolmentId: string; programmeName: string } | null
  >(null);

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
                    onClick={() =>
                      setConfirmingWithdraw({
                        enrolmentId: enrolment.id,
                        programmeName: programme.name,
                      })
                    }
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
      {/* Previously unrendered: a failed withdrawal left the row looking
          exactly as it did before, with no way to tell the write had not
          landed. */}
      {withdraw.isError && (
        <p className="mt-1 text-xs text-red-600">
          {(withdraw.error as Error)?.message ??
            "Could not withdraw this patient. They are still enrolled."}
        </p>
      )}

      <ConfirmDialog
        open={confirmingWithdraw !== null}
        title="Withdraw this patient from the programme?"
        description="Their place on the programme ends and its scheduled check-ins and tasks stop. Re-enrolling later starts a new enrolment rather than resuming this one."
        confirmLabel="Withdraw from programme"
        cancelLabel="Keep them enrolled"
        destructive
        onConfirm={() => {
          const target = confirmingWithdraw;
          setConfirmingWithdraw(null);
          if (target) withdraw.mutate({ enrolmentId: target.enrolmentId, patientId });
        }}
        onCancel={() => setConfirmingWithdraw(null)}
      >
        <ConfirmDialogFacts
          rows={[{ label: "Programme", value: confirmingWithdraw?.programmeName ?? "" }]}
        />
      </ConfirmDialog>
    </div>
  );
}

function formatVersionSnapshot(snapshot: unknown): string {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (s.status) parts.push(`status was "${String(s.status)}"`);
  if (s.condition) parts.push(`condition "${String(s.condition)}"`);
  if (s.notes) parts.push(`notes: "${String(s.notes)}"`);
  return parts.length > 0 ? parts.join(", ") : "no change to the tracked fields";
}

/** §3.18: "Old versions remain accessible." One entry per prior state, newest first. */
function CarePlanHistory({ carePlanId }: { carePlanId: string }) {
  const { data: versions, isLoading } = useCarePlanVersions(carePlanId);

  if (isLoading) return <p className="text-xs text-charcoal-ink/50">Loading history…</p>;
  if (!versions || versions.length === 0) {
    return <p className="text-xs text-charcoal-ink/50">No prior versions. This plan hasn&apos;t changed yet.</p>;
  }

  return (
    <ul className="space-y-1 border-l-2 border-charcoal-ink/10 pl-3">
      {versions.map((version) => (
        <li key={version.id} className="text-xs text-charcoal-ink/70">
          <span className="font-medium text-charcoal-ink/50">
            {new Date(version.created_at).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {": "}
          {formatVersionSnapshot(version.snapshot)}
        </li>
      ))}
    </ul>
  );
}

/**
 * §3.19: a plan eventually reaches ongoing/completed/paused/transferred/
 * declined/discharged — "completed does not necessarily mean cured". Every
 * prior state is preserved in care_plan_versions the moment this write
 * lands, so changing status here never loses history (§3.18) — expand
 * "History" on a plan to see it.
 */
function CarePlanStatusPanel({ patientId }: { patientId: string }) {
  const { data: plans } = useAllCarePlans(patientId);
  const updateStatus = useUpdateCarePlanStatus(patientId);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  if (!plans || plans.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
        Care plans
      </p>
      <ul className="space-y-1.5">
        {plans.map((plan) => (
          <li key={plan.id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-charcoal-ink">{plan.condition.replace("_", " ")}</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpandedPlanId(expandedPlanId === plan.id ? null : plan.id)}
                >
                  {expandedPlanId === plan.id ? "Hide history" : "History"}
                </Button>
                <Select
                  value={plan.status}
                  disabled={updateStatus.isPending}
                  onChange={(e) =>
                    updateStatus.mutate({
                      carePlanId: plan.id,
                      status: e.target.value as Enums<"care_plan_status">,
                    })
                  }
                  className="h-8 w-36 text-xs"
                >
                  {CARE_PLAN_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {expandedPlanId === plan.id && <CarePlanHistory carePlanId={plan.id} />}
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
  const active = (goals ?? []).filter((g) => g.status === "open");

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
                <Button size="sm" onClick={() => update.mutate({ goalId: goal.id, status: "open" })}>
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

/**
 * §3.17: "The care plan should record: recommended option, alternatives,
 * patient preference, agreed plan, reason for decision." Append-only —
 * correcting course means recording a new decision, not editing history.
 */
function SharedDecisionsPanel({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: decisions } = useCarePlanDecisions(patientId);
  const create = useCreateCarePlanDecision(patientId);
  const [showForm, setShowForm] = useState(false);
  const [recommendedOption, setRecommendedOption] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [patientPreference, setPatientPreference] = useState("");
  const [agreedPlan, setAgreedPlan] = useState("");
  const [reason, setReason] = useState("");

  const resetForm = () => {
    setRecommendedOption("");
    setAlternatives("");
    setPatientPreference("");
    setAgreedPlan("");
    setReason("");
    setShowForm(false);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
          Shared decisions
        </p>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            Record a decision
          </Button>
        )}
      </div>

      {showForm && (
        <form
          className="mb-3 space-y-2 rounded-md border border-charcoal-ink/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!recommendedOption.trim() || !agreedPlan.trim()) return;
            create.mutate(
              {
                organisationId,
                recommendedOption: recommendedOption.trim(),
                alternatives: alternatives
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean),
                patientPreference: patientPreference.trim() || undefined,
                agreedPlan: agreedPlan.trim(),
                reason: reason.trim() || undefined,
              },
              { onSuccess: resetForm },
            );
          }}
        >
          <Input
            placeholder="Recommended option"
            value={recommendedOption}
            onChange={(e) => setRecommendedOption(e.target.value)}
          />
          <Input
            placeholder="Alternatives discussed (comma-separated)"
            value={alternatives}
            onChange={(e) => setAlternatives(e.target.value)}
          />
          <Input
            placeholder="Patient's preference"
            value={patientPreference}
            onChange={(e) => setPatientPreference(e.target.value)}
          />
          <Input
            placeholder="Agreed plan"
            value={agreedPlan}
            onChange={(e) => setAgreedPlan(e.target.value)}
          />
          <Input
            placeholder="Reason for the decision"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save decision"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
          {create.isError && (
            <p className="text-xs text-red-600">
              {(create.error as Error)?.message ?? "Could not save this decision."}
            </p>
          )}
        </form>
      )}

      <ul className="space-y-2">
        {(decisions ?? []).map((decision) => (
          <li key={decision.id} className="rounded-md bg-charcoal-ink/5 p-2 text-sm">
            <p className="font-medium text-charcoal-ink">Agreed: {decision.agreed_plan}</p>
            <p className="text-xs text-charcoal-ink/60">Recommended: {decision.recommended_option}</p>
            {decision.patient_preference && (
              <p className="text-xs text-charcoal-ink/60">
                Patient preference: {decision.patient_preference}
              </p>
            )}
            {decision.reason && <p className="text-xs text-charcoal-ink/60">Why: {decision.reason}</p>}
            <p className="mt-1 text-xs text-charcoal-ink/40">
              {new Date(decision.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </li>
        ))}
        {(decisions ?? []).length === 0 && !showForm && (
          <li className="text-sm text-charcoal-ink/60">No shared decisions recorded yet.</li>
        )}
      </ul>
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
        <SharedDecisionsPanel patientId={patientId} organisationId={organisationId} />
        <TasksPanel patientId={patientId} organisationId={organisationId} />
      </CardContent>
    </Card>
  );
}
