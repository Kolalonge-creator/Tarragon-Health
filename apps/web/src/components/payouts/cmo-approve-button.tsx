"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { approvePayoutAsCmo, type ApprovePayoutState } from "@/app/(dashboard)/clinician/payout-approvals/actions";

/** One Approve button for one draft. The labels come from the page (already translated); a failure is shown as a failure. */
export function CmoApproveButton({ payoutId, disabled, label, workingLabel }: { payoutId: string; disabled: boolean; label: string; workingLabel: string }) {
  const [state, run, pending] = useActionState<ApprovePayoutState, FormData>(approvePayoutAsCmo, undefined);
  return (
    <form action={run} className="inline-flex flex-col gap-1">
      <input type="hidden" name="payout_id" value={payoutId} />
      <Button type="submit" size="sm" disabled={disabled || pending}>{pending ? workingLabel : label}</Button>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p role="status" className="text-sm text-brand-green">{state.message}</p>}
    </form>
  );
}
