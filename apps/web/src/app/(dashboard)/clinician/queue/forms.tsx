"use client";

import { useActionState, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { attemptMethodLabelKey, outcomeLabelKey, type CompletionOptions } from "@/lib/clinician/queue-console";
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
      {state?.message && (
        <p role="status" className="text-sm text-brand-green">
          {t("queue.extended", locale)}
          {state.expiresAt ? ` ${new Date(state.expiresAt).toLocaleTimeString("en-GB", { timeStyle: "short", timeZone: "Africa/Lagos" })}` : ""}
        </p>
      )}
      <Err text={state?.error} />
    </form>
  );
}

/**
 * Finish a held task with a coded outcome (S16-S20 D4): the codes this task type lists, a note that is only a note, and, for a
 * critical result closed by trying to reach the patient, the attempts. The database checks the same things.
 */
export function CompleteForm({ taskId, options, locale = "en" }: { taskId: string; options: CompletionOptions; locale?: Locale }) {
  const [state, action, pending] = useActionState<QueueActionState, FormData>(completeTask, undefined);
  const [code, setCode] = useState("");
  const showAttempts = options.attemptsCode !== null && code === options.attemptsCode;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="task_id" value={taskId} />
      <div>
        <Label htmlFor="complete-code">{t("task.outcome_code", locale)}</Label>
        <Select id="complete-code" name="code" value={code} onChange={(e) => setCode(e.target.value)} required>
          <option value="">{t("task.outcome_code_choose", locale)}</option>
          {options.codes.map((c) => (
            <option key={c} value={c}>
              {t(outcomeLabelKey(c), locale)}
            </option>
          ))}
        </Select>
      </div>
      {showAttempts && (
        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
          <legend className="px-1 text-sm font-medium text-charcoal-ink">{t("task.attempts_title", locale)}</legend>
          <p className="text-xs text-charcoal-ink/60">{t("task.attempts_hint", locale, { count: options.minAttempts })}</p>
          {/* the required number of rows and one spare, so a clinician can record one more than the minimum */}
          {Array.from({ length: options.minAttempts + 1 }, (_unused, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor={`attempt-method-${i}`}>{t("task.attempt_method", locale)}</Label>
                <Select id={`attempt-method-${i}`} name={`attempt_method_${i}`} defaultValue="">
                  <option value="" />
                  {options.methods.map((m) => (
                    <option key={m} value={m}>
                      {t(attemptMethodLabelKey(m), locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`attempt-at-${i}`}>{t("task.attempt_at", locale)}</Label>
                <input id={`attempt-at-${i}`} name={`attempt_at_${i}`} type="datetime-local" className="rounded-md border border-charcoal-ink/20 px-2 py-1 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm text-charcoal-ink">
                <input type="checkbox" name={`attempt_reached_${i}`} />
                {t("task.attempt_reached", locale)}
              </label>
            </div>
          ))}
        </fieldset>
      )}
      <div>
        <Label htmlFor="complete-note">{t("task.outcome_note_optional", locale)}</Label>
        <Textarea id="complete-note" name="note" rows={3} maxLength={options.noteMaxChars} />
      </div>
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
        {/* No reason is pre-selected: a hand-back is a decision, and a default would be chosen by whoever hurries (S16-S20 D7). */}
        <Select id="handback-reason" name="reason" defaultValue="" required>
          <option value="">{t("task.handback_reason_choose", locale)}</option>
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
