"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { SafetyItem } from "@/lib/community/model";
import { formatWhen } from "./staff-format";
import type { SafetyCallbacks, StaffActionResult } from "./staff-types";

const KIND_LABEL: Record<SafetyItem["kind"], string> = {
  self_harm_language: "Self-harm language",
  emergency_language: "Emergency language",
  reviewer_concern: "A member reported a concern",
};

function SafetyCard({ item, busy, run, onDecide }: { item: SafetyItem; busy: boolean; run: (fn: () => Promise<StaffActionResult>) => void } & SafetyCallbacks) {
  const uid = useId();
  const [confirmRelease, setConfirmRelease] = useState(false);
  return (
    <li className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4" aria-labelledby={`${uid}-t`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h3 id={`${uid}-t`} className="font-semibold text-charcoal-ink">
          {KIND_LABEL[item.kind]}
        </h3>
        <span className="text-charcoal-ink/70">
          in {item.group_name}, by <span className="font-medium">{item.author_handle}</span>
        </span>
        {item.status === "in_review" && <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">In review</span>}
        <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={item.created_at}>
          {formatWhen(item.created_at)}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink">{item.body}</p>
      {!confirmRelease ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRelease(true)}>
            Release
          </Button>
          <Button size="sm" disabled={busy} onClick={() => run(() => onDecide({ signalId: item.signal_id, decision: "keep_withheld" }))}>
            Keep withheld
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => onDecide({ signalId: item.signal_id, decision: "close" }))}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <p className="text-sm font-medium">Release makes this post visible to everyone in the group. Release only if it is safe to show others.</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => onDecide({ signalId: item.signal_id, decision: "release" }))}>
              Yes, release it
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRelease(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The safety queue: posts held back because they may mean someone is in danger. Handle and text only, never an identity. */
export function SafetyQueue({ items, onDecide }: { items: SafetyItem[] } & SafetyCallbacks) {
  const [message, setMessage] = useState<StaffActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<StaffActionResult>) {
    startTransition(async () => {
      try {
        setMessage(await fn());
      } catch {
        setMessage({ ok: false, message: "That could not be done. Please try again." });
      }
    });
  }
  return (
    <section aria-label="Safety queue" className="space-y-4">
      <div className="rounded-lg border border-charcoal-ink/15 bg-warm-ivory p-4 text-sm text-charcoal-ink">
        <p className="font-medium">Before you start</p>
        <p>
          These posts were held back because they may mean someone is in danger. Nothing has been sent to the member&apos;s care team or
          emergency contact. Release only if the post is safe to show others. If you believe someone is at risk, follow the crisis process
          your Chief Medical Officer has given you.
        </p>
      </div>
      <div aria-live="polite" role="status" className="min-h-5 text-sm">
        {message && (
          <p className={message.ok ? "text-brand-green" : "text-red-700"}>
            {message.ok ? "Done: " : "Not done: "}
            {message.message}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">Nothing is waiting for you.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <SafetyCard key={item.signal_id} item={item} busy={pending} run={run} onDecide={onDecide} />
          ))}
        </ul>
      )}
    </section>
  );
}
