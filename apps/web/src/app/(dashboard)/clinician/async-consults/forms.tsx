"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ANSWER_KINDS,
  ANSWER_KIND_LABEL,
  HANDBACK_REASONS,
  HANDBACK_REASON_LABEL,
} from "@/lib/clinician/written-questions";
import {
  answerWrittenQuestion,
  handBackTask,
  takeNextTask,
  type WrittenQuestionActionState,
} from "./actions";

export function TakeNextForm() {
  const [state, action, pending] = useActionState<WrittenQuestionActionState, FormData>(takeNextTask, undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Looking for the next task..." : "Take the next task"}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function HandBackForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState<WrittenQuestionActionState, FormData>(handBackTask, undefined);
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="task_id" value={taskId} />
      <p className="text-sm font-medium text-charcoal-ink">Hand this task back</p>
      <div>
        <Label htmlFor={`handback-reason-${taskId}`}>Reason</Label>
        <Select id={`handback-reason-${taskId}`} name="reason" defaultValue="outside_competence">
          {HANDBACK_REASONS.map((r) => (
            <option key={r} value={r}>
              {HANDBACK_REASON_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`handback-note-${taskId}`}>Note (needed for Another reason)</Label>
        <Textarea id={`handback-note-${taskId}`} name="note" rows={2} maxLength={1000} />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Handing back..." : "Hand back"}
      </Button>
    </form>
  );
}

export function AnswerForm({ consultId }: { consultId: string }) {
  const [state, action, pending] = useActionState<WrittenQuestionActionState, FormData>(
    answerWrittenQuestion,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="consult_id" value={consultId} />
      <p className="rounded-md bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink">
        A written reply is guidance only. If this needs a diagnosis, choose &quot;Needs a call&quot;: a call task is
        created and the patient is told they will be called. Do not write a diagnosis in the reply.
      </p>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-charcoal-ink">What kind of reply is this?</legend>
        {ANSWER_KINDS.map((k, i) => (
          <label key={k} className="flex items-center gap-2 text-sm text-charcoal-ink">
            <input type="radio" name="kind" value={k} defaultChecked={i === 0} />
            {ANSWER_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor={`answer-body-${consultId}`}>Your reply, written for the patient</Label>
        <Textarea id={`answer-body-${consultId}`} name="body" rows={6} minLength={10} maxLength={4000} required />
      </div>
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="attested" required className="mt-1" />I have not made a diagnosis.
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send reply"}
      </Button>
    </form>
  );
}
