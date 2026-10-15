"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendApprovedPrepDraftAction } from "@/lib/ai-coach/handoff-actions";

/**
 * S51 (7.7, INV-11): the pre-visit message the assistant drafted from the patient's own record. It is a draft in a text box the patient
 * can change freely. It is sent only when the patient presses the button, it is sent as their own message to their care team, and it is
 * never added to their record by the assistant.
 */
export function PrepDraftEditor({ initialText, conversationId }: { initialText: string; conversationId?: string }) {
  const [text, setText] = useState(initialText);
  const [state, setState] = useState<"editing" | "sending" | "sent" | "discarded" | "error">("editing");
  const [error, setError] = useState<string | null>(null);

  if (state === "discarded") return null;
  if (state === "sent") {
    return <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Sent to your care team. You will see their reply in your messages.</p>;
  }

  async function send() {
    setState("sending");
    setError(null);
    const result = await sendApprovedPrepDraftAction({ text, conversationId });
    if (result.success) setState("sent");
    else {
      setState("error");
      setError(result.error);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <label htmlFor="prep-draft" className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">
        Your message for your care team. Change anything you like. Nothing is sent until you press Send.
      </label>
      <textarea
        id="prep-draft"
        className="min-h-40 w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card p-2 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
      />
      {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={state === "sending" || text.trim().length < 10} onClick={() => void send()}>
          Send to my care team
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setState("discarded")}>
          Discard
        </Button>
      </div>
    </div>
  );
}
