"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AppealItem } from "@/lib/community/model";
import { formatWhen } from "./staff-format";
import { useStaffAction, StaffMessage } from "./use-staff-action";
import { NOTE_MAX, REMOVE_REASONS, SANCTION_KINDS, type AppealCallbacks, type AppealDecision } from "./staff-types";

const reasonLabel = (code: string | null): string => (code === null ? "No reason was recorded" : (REMOVE_REASONS.find((r) => r.code === code)?.label ?? "Another reason"));
const sanctionLabel = (kind: string | null): string => SANCTION_KINDS.find((k) => k.code === kind)?.label ?? "A sanction";

function AppealCard({ item, busy, run, onDecide }: { item: AppealItem; busy: boolean; run: (fn: () => ReturnType<AppealCallbacks["onDecide"]>) => void } & AppealCallbacks) {
  const uid = useId();
  const [note, setNote] = useState("");
  const [confirmReverse, setConfirmReverse] = useState(false);

  function decide(decision: AppealDecision) {
    run(() => onDecide({ appealId: item.appeal_id, decision, ...(note.trim() !== "" ? { note: note.trim() } : {}) }));
  }

  const isSanction = item.kind === "sanction";
  return (
    <li className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4" aria-labelledby={`${uid}-t`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h3 id={`${uid}-t`} className="font-semibold text-charcoal-ink">
          {item.group_name}
        </h3>
        <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">{isSanction ? "Appeal against a sanction" : "Appeal against a removed post"}</span>
        <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={item.created_at}>
          {formatWhen(item.created_at)}
        </time>
      </div>

      <div className="space-y-1 text-sm text-charcoal-ink/80">
        <p className="font-medium">What the member says</p>
        <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-charcoal-ink">{item.member_says}</p>
      </div>

      <div className="text-sm text-charcoal-ink/80">
        <p>
          <span className="font-medium">The original reason:</span> {reasonLabel(item.original_reason_code)}.
        </p>
        {isSanction && (
          <p>
            <span className="font-medium">The sanction:</span> {sanctionLabel(item.sanction_kind)}.
          </p>
        )}
      </div>

      {!isSanction && (
        <div className="space-y-1 text-sm text-charcoal-ink/80">
          <p className="font-medium">
            The post{item.author_handle ? <> by <span className="font-semibold">{item.author_handle}</span></> : null}
          </p>
          {item.body !== null ? (
            <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-charcoal-ink">{item.body}</p>
          ) : (
            <p className="rounded-md bg-warm-ivory p-3 text-charcoal-ink/70">The text of this post is no longer kept.</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor={`${uid}-n`} className="block text-sm font-medium">
          Note (optional, up to {NOTE_MAX} characters)
        </label>
        <Textarea id={`${uid}-n`} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {!confirmReverse ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide("uphold")}>
            Uphold the decision
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmReverse(true)}>
            Reverse the decision
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <p className="text-sm font-medium" role="status">
            {isSanction
              ? "Reversing lifts the sanction for this member and tells them the result. Reverse it?"
              : "Reversing puts the post back in the group and tells the member the result. Reverse it?"}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => decide("overturn")}>
              Yes, reverse it
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmReverse(false)}>
              Go back
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Appeals a member has made against a removal or a sanction. The member is only ever a handle (or nothing, for a sanction): there is
 * no identity here. A moderator never sees an appeal against their own decision; the database enforces that, not this screen.
 */
export function AppealQueue({ items, onDecide }: { items: AppealItem[] } & AppealCallbacks) {
  const { message, pending, run } = useStaffAction();
  return (
    <section aria-label="Appeals" className="space-y-4">
      <div className="rounded-lg border border-charcoal-ink/15 bg-warm-ivory p-4 text-sm text-charcoal-ink">
        <p className="font-medium">About appeals</p>
        <p>
          A member has asked for a decision to be looked at again. You are never shown an appeal against a decision you made yourself.
          Upholding keeps the decision. Reversing undoes it. Either way the member is told the result.
        </p>
      </div>
      <StaffMessage message={message} />
      {items.length === 0 ? (
        <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">No appeals are waiting for you.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <AppealCard key={item.appeal_id} item={item} busy={pending} run={run} onDecide={onDecide} />
          ))}
        </ul>
      )}
    </section>
  );
}
