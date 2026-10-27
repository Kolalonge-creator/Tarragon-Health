"use client";

import { useState } from "react";
import { t, circleToolsTaskKindKey, type Locale } from "@tarragon/i18n";
import { CIRCLE_TASK_KINDS } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { taskErrorIsLimit } from "@/lib/care-circle/model";
import { CircleError, useCircleTasks, usePostTask, useTaskAction, useToolsStatus, type TaskAction } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * Small shared jobs inside one person's circle (S69b). A fixed list of kinds and an optional date: nothing is typed in, so nothing
 * medical can be written here, and there is no chat. The patient and a supporter in the "Can see and help" preset can add jobs; that
 * supporter can claim, release and finish; a supporter who can only see reads the list. The database decides who may do what and sends
 * a flag per job, so this screen never works it out itself. Renders nothing while the tool is off.
 */
export function CircleTasksPanel({ patientId, locale }: { patientId: string; locale: Locale }) {
  const tools = useToolsStatus();
  const on = tools.data?.tasks === true;
  const list = useCircleTasks(patientId, on);
  const post = usePostTask(patientId);
  const act = useTaskAction(patientId);
  const [kind, setKind] = useState<string>(CIRCLE_TASK_KINDS[0]);
  const [date, setDate] = useState("");
  const [error, setError] = useState<"limit" | "generic" | "taken" | null>(null);

  if (!on || list.isError) return null;
  if (list.isPending) return null;
  const { role, tasks } = list.data;
  const canPost = role === "patient" || role === "helper";

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
    try {
      await post.mutateAsync({ kind, neededBy: date || null });
      setDate("");
    } catch (err) {
      setError(taskErrorIsLimit(err instanceof CircleError ? err.message : null) ? "limit" : "generic");
    }
  }

  const errorText = error === "limit" ? t("cctools.tasks.limit", locale) : error === "taken" ? t("cctools.tasks.taken", locale) : error === "generic" ? t("cctools.tasks.error", locale) : null;

  return (
    <Card>
      <CardHeader><CardTitle>{t("cctools.tasks.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className={MUTED}>{t("cctools.tasks.intro", locale)}</p>
        {role === "viewer" ? <p className="text-sm">{t("cctools.tasks.view_only", locale)}</p> : null}
        {tasks.length === 0 ? <p className={MUTED}>{t("cctools.tasks.empty", locale)}</p> : null}
        <ul className="divide-y">
          {tasks.map((task) => (
            <li key={task.task_id} className="space-y-2 py-3">
              <p className="font-medium">{t(circleToolsTaskKindKey(task.kind), locale)}</p>
              <p className={`text-sm ${MUTED}`}>
                {task.needed_by ? `${t("cctools.tasks.needed_by", locale, { date: formatPatientDate(task.needed_by) })}. ` : ""}
                {task.state === "done"
                  ? t("cctools.tasks.state.done", locale)
                  : task.state === "claimed"
                    ? task.mine ? t("cctools.tasks.state.claimed_mine", locale) : t("cctools.tasks.state.claimed_other", locale, { name: task.claimed_by_name ?? "Someone" })
                    : t("cctools.tasks.state.open", locale)}
              </p>
              <div className="flex flex-wrap gap-3">
                {task.can_claim ? <Button type="button" className={TOUCH} disabled={act.isPending} onClick={() => void run("claim_circle_task", task.task_id)}>{t("cctools.tasks.claim", locale)}</Button> : null}
                {task.can_release ? <Button type="button" variant="outline" className={TOUCH} disabled={act.isPending} onClick={() => void run("release_circle_task", task.task_id)}>{t("cctools.tasks.release", locale)}</Button> : null}
                {task.can_complete ? <Button type="button" className={TOUCH} disabled={act.isPending} onClick={() => void run("complete_circle_task", task.task_id)}>{t("cctools.tasks.complete", locale)}</Button> : null}
                {task.can_cancel ? <Button type="button" variant="outline" className={TOUCH} disabled={act.isPending} onClick={() => void run("cancel_circle_task", task.task_id)}>{t("cctools.tasks.cancel", locale)}</Button> : null}
              </div>
            </li>
          ))}
        </ul>
        {canPost ? (
          <form onSubmit={add} className="space-y-3" noValidate>
            <div className="space-y-1">
              <Label htmlFor={`task-kind-${patientId}`}>{t("cctools.tasks.kind", locale)}</Label>
              <select id={`task-kind-${patientId}`} className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={kind} onChange={(e) => setKind(e.target.value)}>
                {CIRCLE_TASK_KINDS.map((k) => <option key={k} value={k}>{t(circleToolsTaskKindKey(k), locale)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`task-date-${patientId}`}>{t("cctools.tasks.date", locale)}</Label>
              <input id={`task-date-${patientId}`} type="date" className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button type="submit" className={TOUCH} disabled={post.isPending}>{t("cctools.tasks.post", locale)}</Button>
          </form>
        ) : null}
        <FormError id={`task-error-${patientId}`} message={errorText} />
      </CardContent>
    </Card>
  );
}
