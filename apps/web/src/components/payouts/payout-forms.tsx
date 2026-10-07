"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approvePayout, buildPayoutDrafts, discardPayoutDraft, retryPayout, sendPayout, type PayoutActionState } from "@/app/(dashboard)/admin/payouts/actions";
import { saveBankAccount, saveTaxProfile, type BankActionState } from "@/app/(dashboard)/clinician/payouts/actions";
import { adminActionsFor, type AdminPayoutRow } from "@/lib/payouts/payouts";

function Feedback({ state }: { state: { error?: string; message?: string } | undefined }) {
  return (
    <>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
    </>
  );
}

function OneButton({ action, payoutId, label, variant }: { action: (p: PayoutActionState, f: FormData) => Promise<PayoutActionState>; payoutId: string; label: string; variant?: "outline" }) {
  const [state, run, pending] = useActionState<PayoutActionState, FormData>(action, undefined);
  return (
    <form action={run} className="inline-flex flex-col gap-1">
      <input type="hidden" name="payout_id" value={payoutId} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? "Working..." : label}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function PayoutRowActions({ row }: { row: AdminPayoutRow }) {
  const acts = adminActionsFor(row);
  return (
    <div className="flex flex-wrap items-start gap-2">
      {acts.includes("approve") && <OneButton action={approvePayout} payoutId={row.id} label="Approve" />}
      {acts.includes("send") && <OneButton action={sendPayout} payoutId={row.id} label="Send" />}
      {acts.includes("retry") && <OneButton action={retryPayout} payoutId={row.id} label="Prepare to try again" variant="outline" />}
      {acts.includes("discard") && <OneButton action={discardPayoutDraft} payoutId={row.id} label="Discard" variant="outline" />}
    </div>
  );
}

export function BuildDraftsForm() {
  const [state, run, pending] = useActionState<PayoutActionState, FormData>(buildPayoutDrafts, undefined);
  return (
    <form action={run} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Working..." : "Make this week's drafts now"}</Button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rebuild" value="1" /> Replace drafts that are still drafts</label>
      <Feedback state={state} />
    </form>
  );
}

export function BankForm({ banks }: { banks: readonly { code: string; name: string }[] }) {
  const [state, run, pending] = useActionState<BankActionState, FormData>(saveBankAccount, undefined);
  return (
    <form action={run} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="bank_code">Bank</Label>
        <select id="bank_code" name="bank_code" required className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" defaultValue="">
          <option value="" disabled>Choose your bank</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="account_number">Account number (ten digits)</Label>
        <Input id="account_number" name="account_number" inputMode="numeric" autoComplete="off" pattern="\d{10}" maxLength={10} required />
      </div>
      <p className="text-xs text-charcoal-ink/60">We check the name the bank holds against the name on your registration. We keep the bank and the last four digits only.</p>
      <Button type="submit" disabled={pending}>{pending ? "Checking with your bank..." : "Check and save"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function TaxForm({ initial }: { initial: { tin: string | null; contractor_status: string; registered_name: string | null; vat_registered: boolean; note: string | null } | null }) {
  const [state, run, pending] = useActionState<BankActionState, FormData>(saveTaxProfile, undefined);
  return (
    <form action={run} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="tin">Tax identification number (TIN)</Label>
        <Input id="tin" name="tin" defaultValue={initial?.tin ?? ""} autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="status">You are paid as</Label>
        <select id="status" name="status" defaultValue={initial?.contractor_status ?? "unknown"} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="unknown">Not sure yet</option>
          <option value="individual">An individual</option>
          <option value="company">A registered business</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="registered_name">Registered business name (if any)</Label>
        <Input id="registered_name" name="registered_name" defaultValue={initial?.registered_name ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="vat" defaultChecked={initial?.vat_registered ?? false} /> I am registered for VAT</label>
      <div className="space-y-1">
        <Label htmlFor="note">Anything we should know</Label>
        <Input id="note" name="note" defaultValue={initial?.note ?? ""} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <Feedback state={state} />
    </form>
  );
}
