"use client";

import { useState } from "react";
import { t, circleToolsTaskKindKey, type Locale } from "@tarragon/i18n";
import { CIRCLE_TASK_KINDS, CIRCLE_TASK_NOTE_MAX } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { taskErrorIsLimit, type CircleTask } from "@/lib/care-circle/model";
import { CircleError, useCircleTasks, useMyCircle, usePostTask, useTaskAction, useToolsStatus, type TaskAction } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * Help requests inside one person's circle (S69b shared jobs, extended by Care Circle P3). A fixed list of kinds, an optional date, and
 * (the patient only, founder decision D4) a short note. The patient may send a request to chosen people; then only they see it, are
 * told, and can answer ("I can help", "I can't help", done). Nothing here is an emergency route. The database decides who may do what and
 * sends a flag per request, so this screen never works it out itself. Renders nothing while the tool is off.
 */
export function CircleTasksPanel({ patientId, locale }: { patientId: string; locale: Locale }) {
  const tools = useToolsStatus();
  const on = tools.data?.tasks === true;
  const list = useCircleTasks(patientId, on);
  const post = usePostTask(patientId);
  const act = useTaskAction(patientId);
  const [kind, setKind] = useState<string>(CIRCLE_TASK_KINDS[0]);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [error, setError] = useState<"limit" | "generic" | "taken" | "note" | null>(null);

  if (!on || list.isError) return null;
  if (list.isPending) return null;
  const { role, tasks } = list.data;
  const canPost = role === "patient" || role === "helper";
  const anyAnswerable = tasks.some((x) => x.can_claim || x.can_decline);

  async function run(action: TaskAction, taskId: string) {
    setError(null);
    try {
      const ok = await act.mutateAsync({ action, taskId });
      if (!ok && action === "claim_circle_task") setError("taken");
    } catch {
      setError("generic");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === "other" && !note.trim()) {
      setError("note");
      return;
    }
    try {
      await post.mutateAsync({ kind, neededBy: date || null, recipients: role === "patient" ? to : null, note: role === "patient" ? note : null });
      setDate("");
      setNote("");
      setTo([]);
    } catch (err) {
      setError(taskErrorIsLimit(err instanceof CircleError ? err.message : null) ? "limit" : "generic");
    }
  }

  const errorText =
    error === "limit" ? t("cctools.tasks.limit", locale)
      : error === "taken" ? t("cctools.tasks.taken", locale)
        : error === "note" ? t("cctools.tasks.note_needed", locale)
          : error === "generic" ? t("cctools.tasks.error", locale) : null;

  return (
    <Card>
      <CardHeader><CardTitle>{t("cctools.tasks.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className={MUTED}>{t("cctools.tasks.intro", locale)}</p>
        {role === "viewer" && !anyAnswerable ? <p className="text-sm">{t("cctools.tasks.view_only", locale)}</p> : null}
        {tasks.length === 0 ? <p className={MUTED}>{t("cctools.tasks.empty", locale)}</p> : null}
        <ul className="divide-y">
          {tasks.map((task) => <TaskRow key={task.task_id} task={task} locale={locale} busy={act.isPending} run={run} />)}
        </ul>
        {canPost ? (
          <form onSubmit={add} className="space-y-3" noValidate>
            <div className="space-y-1">
              <Label htmlFor={`task-kind-${patientId}`}>{t("cctools.tasks.kind", locale)}</Label>
              <select id={`task-kind-${patientId}`} className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={kind} onChange={(e) => setKind(e.target.value)}>
                {CIRCLE_TASK_KINDS.filter((k) => role === "patient" || k !== "other").map((k) => <option key={k} value={k}>{t(circleToolsTaskKindKey(k), locale)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`task-date-${patientId}`}>{t("cctools.tasks.date", locale)}</Label>
              <input id={`task-date-${patientId}`} type="date" className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {role === "patient" ? <PatientOnlyFields patientId={patientId} locale={locale} note={note} setNote={setNote} to={to} setTo={setTo} /> : null}
            <Button type="submit" className={TOUCH} disabled={post.isPending}>{t("cctools.tasks.post", locale)}</Button>
          </form>
        ) : null}
        <FormError id={`task-error-${patientId}`} message={errorText} />
      </CardContent>
    </Card>
  );
}

function TaskRow({ task, locale, busy, run }: { task: CircleTask; locale: Locale; busy: boolean; run: (a: TaskAction, id: string) => Promise<void> }) {
  return (
    <li className="space-y-2 py-3">
      <p className="font-medium">
        {t(circleToolsTaskKindKey(task.kind), locale)}
        {task.addressed && !task.recipients ? <span className={`ml-2 text-sm font-normal ${MUTED}`}>{t("cctools.tasks.for_you", locale)}</span> : null}
      </p>
      {task.note ? <p className="text-sm">{task.note}</p> : null}
      <p className={`text-sm ${MUTED}`}>
        {task.needed_by ? `${t("cctools.tasks.needed_by", locale, { date: formatPatientDate(task.needed_by) })}. ` : ""}
        {task.state === "done"
          ? t("cctools.tasks.state.done", locale)
          : task.state === "claimed"
            ? task.mine ? t("cctools.tasks.state.claimed_mine", locale) : t("cctools.tasks.state.claimed_other", locale, { name: task.claimed_by_name ?? "Someone" })
            : t("cctools.tasks.state.open", locale)}
      </p>
      {/* the patient sees each named person's answer */}
      {task.recipients ? (
        <ul className="space-y-0.5 text-sm">
          {task.recipients.map((r) => (
            <li key={r.name}>
              {r.answer === "can_help" ? t("cctools.tasks.answer.can_help", locale, { name: r.name })
                : r.answer === "cannot_help" ? t("cctools.tasks.answer.cannot_help", locale, { name: r.name })
                  : t("cctools.tasks.answer.waiting", locale, { name: r.name })}
            </li>
          ))}
        </ul>
      ) : null}
      {task.my_answer === "cannot_help" ? <p className="text-sm">{t("cctools.tasks.declined_mine", locale)}</p> : null}
      <div className="flex flex-wrap gap-3">
        {task.can_claim ? <Button type="button" className={TOUCH} disabled={busy} onClick={() => void run("claim_circle_task", task.task_id)}>{t("cctools.tasks.claim", locale)}</Button> : null}
        {task.can_decline ? <Button type="button" variant="outline" className={TOUCH} disabled={busy} onClick={() => void run("decline_circle_task", task.task_id)}>{t("cctools.tasks.decline", locale)}</Button> : null}
        {task.can_release ? <Button type="button" variant="outline" className={TOUCH} disabled={busy} onClick={() => void run("release_circle_task", task.task_id)}>{t("cctools.tasks.release", locale)}</Button> : null}
        {task.can_complete ? <Button type="button" className={TOUCH} disabled={busy} onClick={() => void run("complete_circle_task", task.task_id)}>{t("cctools.tasks.complete", locale)}</Button> : null}
        {task.can_cancel ? <Button type="button" variant="outline" className={TOUCH} disabled={busy} onClick={() => void run("cancel_circle_task", task.task_id)}>{t("cctools.tasks.cancel", locale)}</Button> : null}
      </div>
    </li>
  );
}

/** P3: only the patient chooses who a request is for and writes a note (D4). Nobody ticked = everyone who helps, as before. */
function PatientOnlyFields({ patientId, locale, note, setNote, to, setTo }: {
  patientId: string; locale: Locale; note: string; setNote: (v: string) => void; to: string[]; setTo: (v: string[]) => void;
}) {
  const circle = useMyCircle();
  const members = circle.data?.members ?? [];
  return (
    <>
      {members.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("cctools.tasks.who", locale)}</legend>
          <p className={`text-sm ${MUTED}`}>{to.length === 0 ? t("cctools.tasks.who_everyone", locale) : t("cctools.tasks.who_hint", locale)}</p>
          {members.map((m) => {
            const id = `task-to-${patientId}-${m.member_id}`;
            return (
              <div key={m.member_id} className="flex min-h-11 items-center gap-3">
                <input id={id} type="checkbox" className="h-5 w-5" checked={to.includes(m.member_id)}
                  onChange={() => setTo(to.includes(m.member_id) ? to.filter((x) => x !== m.member_id) : [...to, m.member_id])} />
                <Label htmlFor={id} className="font-normal">{m.name} <span className={MUTED}>({m.relationship})</span></Label>
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={`task-note-${patientId}`}>{t("cctools.tasks.note", locale)}</Label>
        <textarea id={`task-note-${patientId}`} maxLength={CIRCLE_TASK_NOTE_MAX} rows={2} className="w-full rounded-md border bg-transparent px-3 py-2"
          aria-describedby={`task-note-hint-${patientId}`} value={note} onChange={(e) => setNote(e.target.value)} />
        <p id={`task-note-hint-${patientId}`} className={`text-sm ${MUTED}`}>{t("cctools.tasks.note_hint", locale)}</p>
      </div>
    </>
  );
}
