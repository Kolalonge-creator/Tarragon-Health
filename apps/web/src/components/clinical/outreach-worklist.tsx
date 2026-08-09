"use client";

import { useState } from "react";
import {
  useOutreachTasks,
  useUpdateOutreachTask,
  type OutreachTaskWithPatient,
  type OutreachTriggerType,
} from "@/lib/queries/care-outreach";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const TRIGGER_LABEL: Record<OutreachTriggerType, string> = {
  high_risk_score: "High risk score",
  overdue_screening: "Overdue screening",
  stale_monitoring: "No recent monitoring",
  unactioned_abnormal: "Abnormal result — not yet in a programme",
  awaiting_result: "Self-arranged test not yet uploaded",
};

export function triggerContext(task: OutreachTaskWithPatient): string | null {
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

interface TaskRowCopy {
  /** Label for the status: open -> in_progress transition. */
  startLabel: string;
  /** Label for the status: -> contacted transition. */
  contactedLabel: string;
  /** Label for the status: -> resolved transition. */
  resolveLabel: string;
  notePlaceholder: string;
}

const DEFAULT_COPY: TaskRowCopy = {
  startLabel: "Start",
  contactedLabel: "Mark contacted",
  resolveLabel: "Resolve",
  notePlaceholder: "Outcome note (e.g. booked review, no answer ×2)",
};

function TaskRow({ task, copy }: { task: OutreachTaskWithPatient; copy: TaskRowCopy }) {
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
            {copy.startLabel}
          </Button>
        )}
        {task.status !== "contacted" && (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ taskId: task.id, status: "contacted" })}
          >
            {copy.contactedLabel}
          </Button>
        )}
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={copy.notePlaceholder}
          className="h-8 min-w-56 flex-1 text-xs"
        />
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ taskId: task.id, status: "resolved", outcomeNote: note.trim() || null })
          }
        >
          {copy.resolveLabel}
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

const PRIORITY_FILTERS = [
  { key: "all", label: "All" },
  { key: "1", label: "Act first" },
  { key: "2", label: "Soon" },
  { key: "3", label: "Routine" },
] as const;

interface OutreachTaskListProps {
  title: string;
  description: string;
  /** Only these trigger types are shown — used for a single-purpose view like
   * the follow-up tracker. Mutually exclusive with excludeTriggerTypes. */
  onlyTriggerTypes?: OutreachTriggerType[];
  /** Every trigger type EXCEPT these is shown — used to keep a general
   * worklist from duplicating a more specific tab elsewhere. */
  excludeTriggerTypes?: OutreachTriggerType[];
  showPriorityFilter?: boolean;
  emptyMessage?: string;
  copy?: Partial<TaskRowCopy>;
}

/**
 * Shared list/filter/action shell behind both the general Outreach worklist
 * and the narrower follow-up tracker (self-arranged tests awaiting a
 * result). Logistics only: contact, note, resolve — anything needing
 * clinical judgment still routes through the existing escalation worklists.
 */
function OutreachTaskList({
  title,
  description,
  onlyTriggerTypes,
  excludeTriggerTypes,
  showPriorityFilter = true,
  emptyMessage = "Nothing waiting — nice and quiet.",
  copy: copyOverride,
}: OutreachTaskListProps) {
  const { data, isLoading, isError } = useOutreachTasks();
  const [priorityFilter, setPriorityFilter] = useState<(typeof PRIORITY_FILTERS)[number]["key"]>("all");
  const copy: TaskRowCopy = { ...DEFAULT_COPY, ...copyOverride };

  const scoped = (data ?? []).filter((task) => {
    if (onlyTriggerTypes) return onlyTriggerTypes.includes(task.trigger_type);
    if (excludeTriggerTypes) return !excludeTriggerTypes.includes(task.trigger_type);
    return true;
  });
  const visible = scoped.filter(
    (task) => priorityFilter === "all" || String(task.priority) === priorityFilter
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">{description}</p>
        {showPriorityFilter && (
          <div className="mb-3 flex flex-wrap gap-2">
            {PRIORITY_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setPriorityFilter(f.key)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors " +
                  (priorityFilter === f.key
                    ? "border-brand-green bg-brand-green text-white"
                    : "border-charcoal-ink/15 bg-white text-charcoal-ink hover:bg-charcoal-ink/5")
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the worklist.</p>}
        {data && scoped.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">{emptyMessage}</p>
        )}
        {data && scoped.length > 0 && visible.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting in this filter.</p>
        )}
        {visible.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} copy={copy} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Proactive-outreach worklist — the acting layer on top of risk scores + care
 * gaps (the Sword Predict / Livongo loop). Logistics only: contact, book,
 * note. Anything needing clinical judgment still goes through the existing
 * escalation worklists — a coordinator resolves the OUTREACH here, never the
 * underlying clinical question.
 *
 * `excludeTriggerTypes` lets a caller keep this from duplicating a more
 * specific tab elsewhere (the Care Coordinator dashboard passes
 * `["awaiting_result"]` since that trigger has its own Bookings/follow-up
 * tab) — the standalone /clinician/outreach page passes nothing and sees
 * everything.
 */
export function OutreachWorklist({
  excludeTriggerTypes,
}: {
  excludeTriggerTypes?: OutreachTriggerType[];
} = {}) {
  return (
    <OutreachTaskList
      title="Proactive outreach"
      description="Patients surfaced automatically from risk scores and open care gaps. Reach out, help them book, and note the outcome — clinical questions still route through escalations."
      excludeTriggerTypes={excludeTriggerTypes}
    />
  );
}

/**
 * Follow-up tracker for self-arranged lab tests: a test was issued 21+ days
 * ago and nothing has been uploaded against it (patient_care_gaps'
 * `awaiting_result` branch). Tarragon doesn't book or pay for the test —
 * self-arranged fulfilment means the patient chose their own lab and pays it
 * directly — so the coordinator's job is to nudge and track, never to book
 * on the patient's behalf. Copy reflects that: "Remind patient" /
 * "Mark followed up" instead of the general worklist's "Mark contacted" /
 * "Resolve".
 */
export function FollowUpTracker() {
  return (
    <OutreachTaskList
      title="Follow-ups"
      description="Self-arranged lab tests issued 21+ days ago with no result uploaded yet. The patient books and pays their own lab — nudge them to go and to upload the result, then mark it followed up."
      onlyTriggerTypes={["awaiting_result"]}
      showPriorityFilter={false}
      emptyMessage="Nothing waiting — every self-arranged test is either done or not yet overdue."
      copy={{
        contactedLabel: "Remind patient",
        resolveLabel: "Mark followed up",
        notePlaceholder: "e.g. confirmed they went, will upload this week",
      }}
    />
  );
}
