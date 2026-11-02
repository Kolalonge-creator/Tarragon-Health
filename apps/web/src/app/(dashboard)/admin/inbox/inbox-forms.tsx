"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeHandoffAction, queueReplyAction, type InboxActionState } from "./actions";

function Result({ state }: { state: InboxActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  return <p role="status" className="text-sm text-deep-forest">{state.done}</p>;
}

export function ReplyForm({ handoffId, suggested, canReply }: { handoffId: string; suggested: string | null; canReply: boolean }) {
  const [state, action, pending] = useActionState(queueReplyAction, undefined);
  if (!canReply) return <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">No email address on file (or they asked not to be contacted), so no reply can be sent from here.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="handoffId" value={handoffId} />
      <label className="block text-sm font-medium">
        Your reply (emailed to the visitor)
        <Textarea name="reply" defaultValue={suggested ?? ""} rows={6} required maxLength={4000} />
      </label>
      {suggested && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Prefilled with the suggested reply. Edit it freely; edits are recorded so good wording can be reused.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Queuing…" : "Send reply"}</Button>
      <Result state={state} />
    </form>
  );
}

export function CloseButton({ handoffId }: { handoffId: string }) {
  const [state, action, pending] = useActionState(closeHandoffAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="handoffId" value={handoffId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? "Closing…" : "Close without replying"}</Button>
      <Result state={state} />
    </form>
  );
}
