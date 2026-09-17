"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { koboToNaira } from "@tarragon/shared";
import {
  getPlatformCreditLedgerAction,
  grantPlatformCreditAction,
  correctPlatformCreditAction,
  type PlatformCreditLedgerRow,
  type PlatformCreditActionState,
} from "./platform-credit-actions";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos" });
}

const ENTRY_LABEL: Record<string, string> = {
  topup: "Top-up",
  admin_grant: "Admin grant",
  spend: "Spend",
  admin_correction: "Correction",
};

function GrantForm({ patientId, onSuccess }: { patientId: string; onSuccess: () => void }) {
  const [state, formAction, pending] = useActionState<PlatformCreditActionState, FormData>(
    grantPlatformCreditAction,
    undefined,
  );
  useEffect(() => {
    if (state?.message) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.message]);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="space-y-1">
        <Label className="text-xs">Grant amount (₦)</Label>
        <Input name="amountNaira" type="number" min="1" step="1" className="h-8 w-28 text-xs" required />
      </div>
      <div className="min-w-[180px] flex-1 space-y-1">
        <Label className="text-xs">Reason</Label>
        <Input name="reason" placeholder="e.g. goodwill after a service outage" className="h-8 text-xs" required />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Granting…" : "Grant"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}

function CorrectForm({ patientId, onSuccess }: { patientId: string; onSuccess: () => void }) {
  const [state, formAction, pending] = useActionState<PlatformCreditActionState, FormData>(
    correctPlatformCreditAction,
    undefined,
  );
  useEffect(() => {
    if (state?.message) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.message]);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="space-y-1">
        <Label className="text-xs">Bucket</Label>
        <Select name="bucket" className="h-8 w-24 text-xs" required defaultValue="paid">
          <option value="paid">Paid</option>
          <option value="promo">Promo</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Direction</Label>
        <Select name="direction" className="h-8 w-28 text-xs" required defaultValue="increase">
          <option value="increase">Increase</option>
          <option value="decrease">Decrease</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Amount (₦)</Label>
        <Input name="amountNaira" type="number" min="1" step="1" className="h-8 w-28 text-xs" required />
      </div>
      <div className="min-w-[180px] flex-1 space-y-1">
        <Label className="text-xs">Reason</Label>
        <Input name="reason" placeholder="e.g. reconciling a bank-transfer top-up" className="h-8 text-xs" required />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Applying…" : "Apply correction"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="w-full text-xs text-brand-green">{state.message}</p>}
    </form>
  );
}

/**
 * Platform credit management for one patient, embedded in the admin patient
 * directory's expandable row detail. Reads (balance, ledger) go through the
 * admin's own RLS-gated session; writes go through the two admin-only RPCs
 * (grant_platform_credit / correct_platform_credit) — this panel exists
 * because neither had any UI caller at all before this, the biggest gap
 * found in the founder's platform-credit audit.
 */
export function PlatformCreditPanel({
  patientId,
  balanceKobo,
  promoBalanceKobo,
}: {
  patientId: string;
  balanceKobo: number;
  promoBalanceKobo: number;
}) {
  const [ledger, setLedger] = useState<PlatformCreditLedgerRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadLedger() {
    setLoadError(null);
    startTransition(async () => {
      try {
        const rows = await getPlatformCreditLedgerAction(patientId);
        setLedger(rows);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load activity.");
      }
    });
  }

  // A grant/correction changes the balance server-side (proven by the
  // directory row re-rendering via revalidatePath), but the ledger list
  // here is client-only state fetched on demand -- refetch it after a
  // successful write so an admin who already had it open sees the new
  // entry immediately, rather than a stale list until they collapse and
  // re-expand the row.
  function refreshLedgerIfLoaded() {
    if (ledger !== null) loadLedger();
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">Platform credit balance: {naira(balanceKobo)}</p>
          {promoBalanceKobo > 0 && (
            <p className="text-xs text-charcoal-ink/50">Includes {naira(promoBalanceKobo)} of promotional credit.</p>
          )}
        </div>
        {ledger === null && (
          <Button type="button" size="sm" variant="ghost" onClick={loadLedger} disabled={isPending}>
            {isPending ? "Loading…" : "Load activity"}
          </Button>
        )}
      </div>

      {loadError && <p className="text-xs text-red-600">{loadError}</p>}

      {ledger && (
        <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-charcoal-ink/10 pt-2">
          {ledger.length === 0 && <li className="text-xs text-charcoal-ink/50">No activity yet.</li>}
          {ledger.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="grey">{ENTRY_LABEL[entry.entryType] ?? entry.entryType}</Badge>
              <span className="text-charcoal-ink/80">{naira(entry.amountKobo)}</span>
              {entry.description && <span className="text-charcoal-ink/50">{entry.description}</span>}
              <span className="text-charcoal-ink/40">
                {shortDateTime(entry.createdAt)} · balance after {naira(entry.balanceAfterKobo)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-charcoal-ink/10 pt-3 sm:grid-cols-1">
        <div>
          <p className="mb-1 text-xs font-medium text-charcoal-ink/70">Grant credit (promotional)</p>
          <GrantForm patientId={patientId} onSuccess={refreshLedgerIfLoaded} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-charcoal-ink/70">
            Manual correction (rare — e.g. reconciling a bank-transfer top-up)
          </p>
          <CorrectForm patientId={patientId} onSuccess={refreshLedgerIfLoaded} />
        </div>
      </div>
    </div>
  );
}
