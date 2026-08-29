"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOutreachTasks,
  useUpdateOutreachTask,
  type OutreachTaskWithPatient,
  type OutreachTriggerType,
} from "@/lib/queries/care-outreach";
import { useStartThread } from "@/lib/queries/care-messages";
import { useRaiseEscalation } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const TRIGGER_LABEL: Record<OutreachTriggerType, string> = {
  high_risk_score: "High risk score",
  overdue_screening: "Overdue screening",
  stale_monitoring: "No recent monitoring",
  unactioned_abnormal: "Abnormal result, not yet in a programme",
  awaiting_result: "Self-arranged test not yet uploaded",
  repeated_no_show: "Repeated no-show",
  consultation_follow_up: "Consultation follow-up needed",
  missed_care_task: "Missed care task",
  missed_appointment: "Missed appointment",
  failed_referral: "Referral could not be completed",
  referral_follow_up: "Referral follow-up needed",
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

/** Inline "message the patient" composer — an in-app care_messages thread,
 * never WhatsApp (see the two-way-conversation-stays-in-app rule in
 * CLAUDE.md). Any org staff account, including a Care Coordinator, may open
 * one via start_care_thread; nothing here needs clinical authority. */
function MessagePatientPanel({
  patientId,
  patientName,
  defaultSubject,
  onClose,
}: {
  patientId: string;
  patientName: string;
  defaultSubject: string;
  onClose: () => void;
}) {
  const start = useStartThread();
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-2 rounded-md border border-brand-green/20 bg-brand-green/5 p-3">
        <p className="text-xs text-charcoal-ink/80">
          Message sent to {patientName}. They&apos;ll see it in the app, and any reply shows up in
          Patient messages.
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3">
      <p className="text-xs font-medium text-charcoal-ink/70">
        New in-app message to {patientName}
      </p>
      <Input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="Subject"
        className="h-8 text-xs"
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Message"
        rows={3}
        className="text-xs"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={start.isPending || subject.trim().length < 3 || body.trim().length === 0}
          onClick={() =>
            start.mutate(
              { patientId, subject: subject.trim(), body: body.trim() },
              { onSuccess: () => setSent(true) }
            )
          }
        >
          {start.isPending ? "Sending…" : "Send"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {start.isError && (
          <span className="text-xs text-red-600">
            {(start.error as Error).message || "Could not send."}
          </span>
        )}
      </div>
    </div>
  );
}

/** Inline "hand this to a doctor" composer. Raises an escalation with no
 * pre-existing clinician_alert (useRaiseEscalation) — the manual path for a
 * case that needs clinical judgment, not logistics. A Care Coordinator may
 * raise one but never claims or resolves it themselves; see the isClinicalTier
 * gating on /clinician/escalations. */
function EscalateToDoctorPanel({
  patientId,
  organisationId,
  patientName,
  defaultReason,
  onClose,
}: {
  patientId: string;
  organisationId: string;
  patientName: string;
  defaultReason: string;
  onClose: () => void;
}) {
  const raise = useRaiseEscalation();
  const [reason, setReason] = useState(defaultReason);
  const [escalated, setEscalated] = useState(false);

  if (escalated) {
    return (
      <div className="space-y-2 rounded-md border border-brand-green/20 bg-brand-green/5 p-3">
        <p className="text-xs text-charcoal-ink/80">
          Escalated {patientName}&apos;s case to the doctor team. It now shows in Escalations.
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3">
      <p className="text-xs font-medium text-charcoal-ink/70">
        Hand {patientName}&apos;s case to a doctor
      </p>
      <Textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why does this need a doctor?"
        rows={3}
        className="text-xs"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={raise.isPending || reason.trim().length === 0}
          onClick={() =>
            raise.mutate(
              { patientId, organisationId, reason: reason.trim() },
              { onSuccess: () => setEscalated(true) }
            )
          }
        >
          {raise.isPending ? "Escalating…" : "Escalate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {raise.isError && (
          <span className="text-xs text-red-600">
            {(raise.error as Error).message || "Could not escalate."}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, copy }: { task: OutreachTaskWithPatient; copy: TaskRowCopy }) {
  const update = useUpdateOutreachTask();
  const [note, setNote] = useState("");
  const [messaging, setMessaging] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const context = triggerContext(task);
  const patientName = task.patient?.full_name ?? "this patient";
  const triggerLabel = TRIGGER_LABEL[task.trigger_type] ?? task.trigger_type;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          <Link href={`/clinician/patients/${task.patient_id}`} className="hover:underline">
            {task.patient?.full_name ?? "Patient"}
          </Link>
          {task.patient?.patient_number ? ` · ${task.patient.patient_number}` : ""}
        </p>
        <Badge variant={task.priority === 1 ? "red" : task.priority === 2 ? "amber" : "grey"}>
          {task.priority === 1 ? "Act first" : task.priority === 2 ? "Soon" : "Routine"}
        </Badge>
        <Badge variant="blue">{triggerLabel}</Badge>
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMessaging((v) => !v);
            setEscalating(false);
          }}
        >
          {messaging ? "Cancel message" : "Message patient"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEscalating((v) => !v);
            setMessaging(false);
          }}
        >
          {escalating ? "Cancel escalation" : "Escalate to doctor"}
        </Button>
      </div>
      {messaging && (
        <MessagePatientPanel
          patientId={task.patient_id}
          patientName={patientName}
          defaultSubject={triggerLabel}
          onClose={() => setMessaging(false)}
        />
      )}
      {escalating && (
        <EscalateToDoctorPanel
          patientId={task.patient_id}
          organisationId={task.organisation_id}
          patientName={patientName}
          defaultReason={`Outreach task: ${triggerLabel}${context ? ` (${context})` : ""}. `}
          onClose={() => setEscalating(false)}
        />
      )}
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
  emptyMessage = "Nothing waiting, nice and quiet.",
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
      description="Patients surfaced automatically from risk scores and open care gaps. Reach out, help them book, and note the outcome; clinical questions still route through escalations."
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
      description="Self-arranged lab tests issued 21+ days ago with no result uploaded yet. The patient books and pays their own lab; nudge them to go and to upload the result, then mark it followed up."
      onlyTriggerTypes={["awaiting_result"]}
      showPriorityFilter={false}
      emptyMessage="Nothing waiting, every self-arranged test is either done or not yet overdue."
      copy={{
        contactedLabel: "Remind patient",
        resolveLabel: "Mark followed up",
        notePlaceholder: "e.g. confirmed they went, will upload this week",
      }}
    />
  );
}
