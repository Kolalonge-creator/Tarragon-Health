"use client";

import { useActionState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HANDBACK_REASONS } from "@/lib/clinician/written-questions";
import { completeTask, extendClaim, handBack, takeNextTask, type QueueActionState } from "./actions";

const Err = ({ text }: { text?: string }) =>
  text ? (
    <p role="alert" className="text-sm text-red-600">
      {text}
    </p>
  ) : null;

export function NextTaskForm({ locale = "en" }: { locale?: Locale }) {
  const [state, action, pending] = useActionState<QueueActionState, FormData>(takeNextTask, undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? t("queue.looking", locale) : t("queue.next_button", locale)}
      </Button>
      <Err text={state?.error} />
    </form>
  );
}

export function ExtendForm({ taskId, locale = "en" }: { taskId: string; locale?: Locale }) {
  const [state, action, pending] = useActionState<QueueActionState, FormData>(extendClaim, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="task_id" value={taskId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("queue.extend", locale)}
      </Button>
      {state?.message && <p role="status" className="text-sm text-brand-green">{t("queue.extended", locale)}</p>}
      <Err text={state?.error} />
    </form>
  );
}

export function CompleteForm({ taskId, locale = "en" }: { taskId: string; locale?: Locale }) {
  const [state, action, pending] = useActionState<QueueActionState, FormData>(completeTask, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="task_id" value={taskId} />
      <Label htmlFor="complete-note">{t("task.outcome_note", locale)}</Label>
      <Textarea id="complete-note" name="note" rows={3} maxLength={1000} required />
      <Err text={state?.error} />
      <Button type="submit" disabled={pending}>
        {t("task.complete_button", locale)}
      </Button>
    </form>
  );
}

export function HandBackForm({ taskId, locale = "en" }: { taskId: string; locale?: Locale }) {
  const [state, action, pending] = useActionState<QueueActionState, FormData>(handBack, undefined);
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="task_id" value={taskId} />
      <p className="text-sm font-medium text-charcoal-ink">{t("task.handback_title", locale)}</p>
      <div>
        <Label htmlFor="handback-reason">{t("task.handback_reason", locale)}</Label>
        <Select id="handback-reason" name="reason" defaultValue="outside_competence">
          {HANDBACK_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`task.handback_reason.${r}`, locale)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="handback-note">{t("task.handback_note", locale)}</Label>
        <Textarea id="handback-note" name="note" rows={2} maxLength={1000} />
      </div>
      <Err text={state?.error} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("task.handback_button", locale)}
      </Button>
    </form>
  );
}
