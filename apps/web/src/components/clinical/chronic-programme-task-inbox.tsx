"use client";

import Link from "next/link";
import {
  useChronicProgrammeCoordinatorTasks,
  useUpdateChronicProgrammeTask,
  useGenerateChronicProgrammeLabOrder,
} from "@/lib/queries/chronic-programme-tasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TASK_LABEL: Record<string, string> = {
  missed_lab_panel: "Missed lab panel",
  missed_doctor_checkin: "Missed doctor check-in",
  lab_panel_due_soon: "Lab panel due soon",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Coordinator worklist for the 12-week chronic-care programme's daily sweep
 * (private.sweep_chronic_programme_occurrences) — logistics only ("chase
 * this patient", "book this test"), never a clinical judgement, matching
 * the Care Coordinator's remit on the Clinical Tier Ladder. A
 * missed_lab_panel task gets a one-click "generate this order" action,
 * which the underlying RPC attributes to the patient's assigned clinician
 * server-side — a Coordinator has no ordering authority of their own.
 */
export function ChronicProgrammeTaskInbox() {
  const { data: tasks, isLoading, isError } = useChronicProgrammeCoordinatorTasks();
  const update = useUpdateChronicProgrammeTask();
  const generateOrder = useGenerateChronicProgrammeLabOrder();

  return (
    <Card>
      <CardHeader>
        <CardTitle>12-week programme tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Patients whose scheduled lab panel or doctor check-in went past due without being
          booked or actioned. Chase, help them book, or generate the order — clinical questions
          still route through escalations.
        </p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load programme tasks.</p>}
        {tasks && tasks.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting, nice and quiet.</p>
        )}
        {tasks && tasks.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {tasks.map((task) => (
              <li key={task.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    <Link href={`/clinician/patients/${task.patient_id}`} className="hover:underline">
                      {task.patient?.full_name ?? "Patient"}
                    </Link>
                    {task.patient?.patient_number ? ` · ${task.patient.patient_number}` : ""}
                  </p>
                  <Badge variant="amber">{TASK_LABEL[task.task_type] ?? task.task_type}</Badge>
                  {task.occurrence && (
                    <span className="text-xs text-charcoal-ink/60">
                      Week {task.occurrence.week_number} · due {formatDate(task.occurrence.due_date)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.task_type === "missed_lab_panel" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generateOrder.isPending}
                      onClick={() =>
                        generateOrder.mutate(task.occurrence_id, {
                          onSuccess: () => update.mutate({ taskId: task.id, status: "done" }),
                        })
                      }
                    >
                      {generateOrder.isPending ? "Generating…" : "Generate this order"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ taskId: task.id, status: "done" })}
                  >
                    Mark done
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ taskId: task.id, status: "dismissed" })}
                  >
                    Dismiss
                  </Button>
                </div>
                {generateOrder.isError && (
                  <p className="text-xs text-red-600">
                    {(generateOrder.error as Error).message || "Could not generate the order."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
