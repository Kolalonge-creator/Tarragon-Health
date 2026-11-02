"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  approveAllAction,
  approveKnowledgeAction,
  approveStepAction,
  saveKnowledgeAction,
  saveStepAction,
  type SignoffActionState,
} from "./actions";

function Result({ state }: { state: SignoffActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  return <p role="status" className="text-sm text-deep-forest">{state.done}</p>;
}

/** One approve button. The fingerprint is of the exact wording on screen, so a change made meanwhile is refused, not approved. */
export function ApproveOne({ kind, id, fingerprint, label }: { kind: "step" | "knowledge"; id: string; fingerprint: string; label: string }) {
  const [state, action, pending] = useActionState(kind === "step" ? approveStepAction : approveKnowledgeAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="approval" value={`${id}:${fingerprint}`} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Approving…" : label}</Button>
      <Result state={state} />
    </form>
  );
}

export function ApproveAll({ steps, knowledge }: { steps: { id: string; fingerprint: string }[]; knowledge: { id: string; fingerprint: string }[] }) {
  const [state, action, pending] = useActionState(approveAllAction, undefined);
  const total = steps.length + knowledge.length;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-charcoal-ink/15 p-4 dark:border-night-ink/20">
      {steps.map((s) => <input key={s.id} type="hidden" name="step" value={`${s.id}:${s.fingerprint}`} />)}
      {knowledge.map((k) => <input key={k.id} type="hidden" name="knowledge" value={`${k.id}:${k.fingerprint}`} />)}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4" />
        <span>I have read every email and every knowledge entry below and approve them exactly as written.</span>
      </label>
      <Button type="submit" size="lg" disabled={pending || total === 0}>
        {pending ? "Approving…" : `Approve all ${total}`}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function EditStep({ id, subject, bodyText }: { id: string; subject: string; bodyText: string }) {
  const [state, action, pending] = useActionState(saveStepAction, undefined);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-deep-forest">Edit wording</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-xs font-medium">Subject<Input name="subject" defaultValue={subject} required minLength={3} maxLength={150} /></label>
        <label className="block text-xs font-medium">Body (use {"{{first_name}}"} and {"{{link}}"} only)
          <Textarea name="body" defaultValue={bodyText} rows={9} required minLength={20} maxLength={4000} />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save (needs approving again)"}</Button>
        <Result state={state} />
      </form>
    </details>
  );
}

export function EditKnowledge({ topic, content }: { topic: string; content: string }) {
  const [state, action, pending] = useActionState(saveKnowledgeAction, undefined);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-deep-forest">Edit wording</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="topic" value={topic} />
        <label className="block text-xs font-medium">Text (placeholders allowed: {"{{membership_price}}"}, {"{{paid_product_name}}"}, {"{{refund_days}}"}, {"{{launch_date}}"})
          <Textarea name="content" defaultValue={content} rows={7} required minLength={20} maxLength={4000} />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save as a new version"}</Button>
        <Result state={state} />
      </form>
    </details>
  );
}
