"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openEarningsDispute, withdrawEarningsDispute, type EarningsDisputeState } from "@/app/(dashboard)/clinician/earnings/actions";
import { decideTopupHold, resolveEarningsDispute, setPayoutWithholding, type DisputeActionState } from "@/app/(dashboard)/admin/earnings/dispute-actions";
import { REASON_CODES, REASON_LABEL } from "@/lib/earnings/disputes";

function Feedback({ state }: { state: { error?: string; message?: string } | undefined }) {
  return (
    <>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
    </>
  );
}

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

/** The clinician's one-tap question on a single line: a reason and an optional note. */
export function DisputeForm({ ledgerId }: { ledgerId: string }) {
  const [state, run, pending] = useActionState<EarningsDisputeState, FormData>(openEarningsDispute, undefined);
  // made once when the form is drawn, so a double tap is one question
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-brand-green">Question this line</summary>
      <form action={run} className="mt-2 space-y-2">
        <input type="hidden" name="ledger_id" value={ledgerId} />
        <input type="hidden" name="request_id" value={requestId} />
        <div className="space-y-1">
          <Label htmlFor={`reason-${ledgerId}`}>What is wrong?</Label>
          <select id={`reason-${ledgerId}`} name="reason_code" required defaultValue="" className={selectClass}>
            <option value="" disabled>Choose one</option>
            {REASON_CODES.map((c) => <option key={c} value={c}>{REASON_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`note-${ledgerId}`}>Anything we should know (optional, no patient names)</Label>
          <Input id={`note-${ledgerId}`} name="note" maxLength={1000} />
        </div>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Sending..." : "Send"}</Button>
        <Feedback state={state} />
      </form>
    </details>
  );
}

export function WithdrawDisputeButton({ disputeId }: { disputeId: string }) {
  const [state, run, pending] = useActionState<EarningsDisputeState, FormData>(withdrawEarningsDispute, undefined);
  return (
    <form action={run} className="inline-flex flex-col gap-1">
      <input type="hidden" name="dispute_id" value={disputeId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Working..." : "Withdraw my question"}</Button>
      <Feedback state={state} />
    </form>
  );
}

/** Finance answers a dispute: a correction line, or a rejection, with a reason the clinician can read. */
export function ResolveDisputeForm({ disputeId }: { disputeId: string }) {
  const [state, run, pending] = useActionState<DisputeActionState, FormData>(resolveEarningsDispute, undefined);
  const [resolution, setResolution] = useState<"adjusted" | "rejected">("adjusted");
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="dispute_id" value={disputeId} />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="resolution" value="adjusted" checked={resolution === "adjusted"} onChange={() => setResolution("adjusted")} /> Add a correction line</label>
        <label className="flex items-center gap-2"><input type="radio" name="resolution" value="rejected" checked={resolution === "rejected"} onChange={() => setResolution("rejected")} /> Turn the question down</label>
      </div>
      {resolution === "adjusted" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`dir-${disputeId}`}>Direction</Label>
            <select id={`dir-${disputeId}`} name="direction" className={selectClass} defaultValue="add">
              <option value="add">Add to what they earn</option>
              <option value="take_away">Take away from what they earn</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`amt-${disputeId}`}>Amount in naira</Label>
            <Input id={`amt-${disputeId}`} name="amount" inputMode="decimal" required />
          </div>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`note-${disputeId}`}>Reason the clinician will read (at least 10 characters, no patient names)</Label>
        <Input id={`note-${disputeId}`} name="note" required minLength={10} maxLength={1000} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Working..." : "Answer"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function TopupHoldForm({ holdId }: { holdId: string }) {
  const [state, run, pending] = useActionState<DisputeActionState, FormData>(decideTopupHold, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="hold_id" value={holdId} />
      <div className="space-y-1">
        <Label htmlFor={`hold-note-${holdId}`}>Reason (at least 10 characters)</Label>
        <Input id={`hold-note-${holdId}`} name="note" required minLength={10} maxLength={1000} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" name="decision" value="released" disabled={pending}>Release the top-up</Button>
        <Button type="submit" size="sm" variant="outline" name="decision" value="denied" disabled={pending}>Deny it</Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** A draft payout's withholding, typed in by a person. Not calculated anywhere (D-09). */
export function WithholdingForm({ payoutId, current }: { payoutId: string; current: string }) {
  const [state, run, pending] = useActionState<DisputeActionState, FormData>(setPayoutWithholding, undefined);
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="payout_id" value={payoutId} />
      <div className="space-y-1">
        <Label htmlFor={`wh-${payoutId}`}>Withholding in naira (typed in, not calculated)</Label>
        <Input id={`wh-${payoutId}`} name="withholding" inputMode="decimal" defaultValue={current} className="w-40" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`whn-${payoutId}`}>Note</Label>
        <Input id={`whn-${payoutId}`} name="note" maxLength={1000} className="w-64" />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <Feedback state={state} />
    </form>
  );
}
