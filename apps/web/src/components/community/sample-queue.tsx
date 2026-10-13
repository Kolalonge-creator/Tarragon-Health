"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SampleItem } from "@/lib/community/model";
import { formatWhen } from "./staff-format";
import { useStaffAction, StaffMessage } from "./use-staff-action";
import { NOTE_MAX, REMOVE_REASONS, type SampleCallbacks } from "./staff-types";

function SampleCard({ item, busy, run, onReview }: { item: SampleItem; busy: boolean; run: (fn: () => ReturnType<SampleCallbacks["onReview"]>) => void } & SampleCallbacks) {
  const uid = useId();
  const [choice, setChoice] = useState<"agree" | "disagree" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const removed = item.decision === "removed";
  const reason = item.reason_code === null ? null : (REMOVE_REASONS.find((r) => r.code === item.reason_code)?.label ?? "Another reason");

  function submit() {
    if (choice === "") return setError("Please choose whether you agree.");
    setError(null);
    run(() => onReview({ sampleId: item.sample_id, agrees: choice === "agree", ...(note.trim() !== "" ? { note: note.trim() } : {}) }));
  }

  return (
    <li className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4" aria-labelledby={`${uid}-t`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h3 id={`${uid}-t`} className="font-semibold text-charcoal-ink">
          {item.group_name}
        </h3>
        {item.author_handle && (
          <span className="text-charcoal-ink/70">
            by <span className="font-medium">{item.author_handle}</span>
          </span>
        )}
        <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={item.created_at}>
          {formatWhen(item.created_at)}
        </time>
      </div>

      {item.body !== null ? (
        <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink">{item.body}</p>
      ) : (
        <p className="rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink/70">The text of this post is no longer kept.</p>
      )}

      <p className="text-sm text-charcoal-ink/80">
        <span className="font-medium">The decision made:</span> {removed ? "the post was removed" : "the post was approved"}
        {removed && reason ? `. Reason: ${reason}` : ""}.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Do you agree with this decision?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label htmlFor={`${uid}-a`} className="flex items-center gap-2">
            <input id={`${uid}-a`} type="radio" name={`${uid}-c`} checked={choice === "agree"} onChange={() => setChoice("agree")} />
            I agree
          </label>
          <label htmlFor={`${uid}-d`} className="flex items-center gap-2">
            <input id={`${uid}-d`} type="radio" name={`${uid}-c`} checked={choice === "disagree"} onChange={() => setChoice("disagree")} />
            I do not agree
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-n`} className="block text-sm font-medium">
          Note (optional, up to {NOTE_MAX} characters)
        </label>
        <Textarea id={`${uid}-n`} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button size="sm" disabled={busy} onClick={submit}>
        Save my answer
      </Button>
    </li>
  );
}

/** A second look at a share of moderator decisions. You are never asked to check your own decision; the database enforces that. */
export function SampleQueue({ items, onReview }: { items: SampleItem[] } & SampleCallbacks) {
  const { message, pending, run } = useStaffAction();
  return (
    <section aria-label="Second look" className="space-y-4">
      <div className="rounded-lg border border-charcoal-ink/15 bg-warm-ivory p-4 text-sm text-charcoal-ink">
        <p className="font-medium">About the second look</p>
        <p>
          A few decisions made by other moderators are picked for a second moderator to check. Nothing changes for the member. Your answer
          only helps the team keep decisions fair and consistent.
        </p>
      </div>
      <StaffMessage message={message} />
      {items.length === 0 ? (
        <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">Nothing is waiting for a second look.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <SampleCard key={item.sample_id} item={item} busy={pending} run={run} onReview={onReview} />
          ))}
        </ul>
      )}
    </section>
  );
}
