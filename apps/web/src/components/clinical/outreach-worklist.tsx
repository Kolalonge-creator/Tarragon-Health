"use client";

import { useState } from "react";
import {
  useOutreachTasks,
  useUpdateOutreachTask,
  type OutreachTaskWithPatient,
} from "@/lib/queries/care-outreach";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TRIGGER_LABEL: Record<string, string> = {
  high_risk_score: "High risk score",
  overdue_screening: "Overdue screening",
  stale_monitoring: "No recent monitoring",
  unactioned_abnormal: "Abnormal result — not yet in a programme",
};

function triggerContext(task: OutreachTaskWithPatient): string | null {
  const detail = task.trigger_detail as Record<string, unknown> | null;
  if (!detail) return null;
  if (task.trigger_type === "high_risk_score") {
    const level = typeof detail.risk_level === "string" ? detail.risk_level : null;
    const type = typeof detail.score_type === "string" ? detail.score_type : null;
    return [type, level ? `${level.replace("_", " ")} risk` : null].filter(Boolean).join(" · ") || null;
  }
  const condition =
    typeof detail.condition_or_type === "string" ? detail.condition_or_type : null;
  return condition;
}

function TaskRow({ task }: { task: OutreachTaskWithPatient }) {
  const update = useUpdateOutreachTask();
  const [note, setNote] = useState("");
  const context = triggerContext(task);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {task.patient?.full_name ?? "Patient"}
          {task.patient?.patient_number ? ` · ${task.patient.patient_number}` : ""}
        </p>
        <Badge variant={task.priority === 1 ? "red" : task.priority === 2 ? "amber" : "grey"}>
          {task.priority === 1 ? "Act first" : task.priority === 2 ? "Soon" : "Routine"}
        </Badge>
        <Badge variant="blue">{TRIGGER_LABEL[task.trigger_type] ?? task.trigger_type}</Badge>
        {task.status !== "open" && (
          <Badge variant="grey">
            {task.status === "in_progress" ? "In progress" : "Contacted"}
          </Badge>
        )}
      </div>
      {context && <p className="text-xs text-charcoal-ink/70">{context}</p>}
      {task.patient?.phone && (
        <p className="text-xs text-charcoal-ink/70">Phone: {task.patient.phone}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {task.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ taskId: task.id, status: "in_progress", claim: true })}
          >
            Start
          </Button>
        )}
        {task.status !== "contacted" && (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ taskId: task.id, status: "contacted" })}
          >
            Mark contacted
          </Button>
        )}
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Outcome note (e.g. booked review, no answer ×2)"
          className="h-8 min-w-56 flex-1 text-xs"
        />
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ taskId: task.id, status: "resolved", outcomeNote: note.trim() || null })
          }
        >
          Resolve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ taskId: task.id, status: "dismissed", outcomeNote: note.trim() || null })
          }
        >
          Dismiss
        </Button>
      </div>
      {update.isError && (
        <p className="text-xs text-red-600">
          {(update.error as Error).message || "Could not update this task."}
        </p>
      )}
    </li>
  );
}

/**
 * Proactive-outreach worklist — the acting layer on top of risk scores + care
 * gaps (the Sword Predict / Livongo loop). Logistics only: contact, book,
 * note. Anything needing clinical judgment still goes through the existing
 * escalation worklists — a coordinator resolves the OUTREACH here, never the
 * underlying clinical question.
 */
export function OutreachWorklist() {
  const { data, isLoading, isError } = useOutreachTasks();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proactive outreach</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Patients surfaced automatically from risk scores and open care gaps. Reach out,
          help them book, and note the outcome — clinical questions still route through
          escalations.
        </p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the outreach worklist.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            Nothing waiting — no patient currently needs proactive outreach.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
