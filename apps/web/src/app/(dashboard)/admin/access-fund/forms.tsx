"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { approveGrant, cancelGrant, confirmDonation, runExpiry, type FundActionState } from "./actions";

const FIELD = "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2";

function Result({ state }: { state: FundActionState }) {
  return (
    <>
      <FormError id="fund-error" message={state?.error ?? null} />
      {state?.message ? <FormSuccess message={state.message} /> : null}
    </>
  );
}

export function ConfirmDonationForm({ id, reference }: { id: string; reference: string }) {
  const [state, action, pending] = useActionState(confirmDonation, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block text-sm font-medium" htmlFor={`bank-${id}`}>Bank reference on the statement (the pledge reference is {reference})</label>
      <input id={`bank-${id}`} name="bank_reference" className={FIELD} autoComplete="off" required minLength={4} maxLength={80} />
      <label className="block text-sm font-medium" htmlFor={`note-${id}`}>What you checked</label>
      <input id={`note-${id}`} name="note" className={FIELD} autoComplete="off" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">{pending ? "Saving" : "Mark as received"}</Button>
      <Result state={state} />
    </form>
  );
}

export function ApproveGrantForm({ criteria, items, labels }: { criteria: string[]; items: { code: string; name: string }[]; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState(approveGrant, undefined);
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="grant-patient">Person (their profile id)</label>
      <input id="grant-patient" name="patient_id" className={FIELD} autoComplete="off" required pattern="[0-9a-fA-F-]{36}" />
      <label className="block text-sm font-medium" htmlFor="grant-item">Item</label>
      <select id="grant-item" name="item_code" className={FIELD} required>
        {items.map((i) => (<option key={i.code} value={i.code}>{i.name}</option>))}
      </select>
      <label className="block text-sm font-medium" htmlFor="grant-naira">Most the Fund will cover, in naira</label>
      <input id="grant-naira" name="naira" type="number" min={1} step={1} className={FIELD} required />
      <label className="block text-sm font-medium" htmlFor="grant-criterion">Published reason</label>
      <select id="grant-criterion" name="criterion" className={FIELD} required>
        {criteria.map((c) => (<option key={c} value={c}>{labels[c] ?? c}</option>))}
      </select>
      <label className="block text-sm font-medium" htmlFor="grant-note">Why this person (kept in the audit log; do not write a diagnosis)</label>
      <input id="grant-note" name="note" className={FIELD} autoComplete="off" required minLength={10} maxLength={500} />
      <Button type="submit" disabled={pending} className="min-h-11">{pending ? "Saving" : "Approve grant"}</Button>
      <Result state={state} />
    </form>
  );
}

export function CancelGrantForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelGrant, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`cancel-${id}`}>Reason for cancelling</label>
      <input id={`cancel-${id}`} name="reason" placeholder="Reason for cancelling" className={`${FIELD} sm:w-72`} required minLength={10} maxLength={500} />
      <Button type="submit" variant="outline" disabled={pending} className="min-h-11">{pending ? "Saving" : "Cancel grant"}</Button>
      <Result state={state} />
    </form>
  );
}

export function ExpiryButton() {
  const [state, action, pending] = useActionState(async () => runExpiry(), undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending} className="min-h-11">{pending ? "Working" : "Lapse old pledges and expire old grants"}</Button>
      <Result state={state} />
    </form>
  );
}
