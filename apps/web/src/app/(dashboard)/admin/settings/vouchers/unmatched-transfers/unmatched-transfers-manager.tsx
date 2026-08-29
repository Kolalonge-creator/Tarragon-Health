"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { UnmatchedTransferWithCandidates } from "@/lib/queries/unmatched-bank-transfers";
import { applyToBookingAction, applyToVoucherAction, ignoreTransferAction } from "./actions";

function kobo(n: number) {
  return `₦${(n / 100).toLocaleString()}`;
}

function TransferRow({ transfer }: { transfer: UnmatchedTransferWithCandidates }) {
  const [selected, setSelected] = useState("");
  const [voucherState, voucherAction, voucherPending] = useActionState(applyToVoucherAction, undefined);
  const [bookingState, bookingAction, bookingPending] = useActionState(applyToBookingAction, undefined);
  const [ignoreState, ignoreAction, ignorePending] = useActionState(ignoreTransferAction, undefined);

  const candidate = transfer.candidates.find((c) => `${c.kind}:${c.id}` === selected);
  const pending = voucherPending || bookingPending || ignorePending;
  const error = voucherState?.error || bookingState?.error || ignoreState?.error;
  const message = voucherState?.message || bookingState?.message || ignoreState?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kobo(transfer.amount_kobo)} — {transfer.payer_name ?? "Unidentified payer"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-charcoal-ink/70">{transfer.note}</p>
        {transfer.payer_phone && <p className="text-charcoal-ink/60">{transfer.payer_phone}</p>}
        <p className="text-xs text-charcoal-ink/50">
          Received {new Date(transfer.created_at).toLocaleString()}
        </p>

        {transfer.candidates.length > 0 && (
          <div className="space-y-2">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Apply toward…</option>
              {transfer.candidates.map((c) => (
                <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                  {c.label} — {kobo(c.outstanding_kobo)} owed
                </option>
              ))}
            </Select>
            {candidate && candidate.kind === "voucher" && (
              <form action={voucherAction}>
                <input type="hidden" name="transfer_id" value={transfer.id} />
                <input type="hidden" name="voucher_id" value={candidate.id} />
                <Button type="submit" size="sm" disabled={pending}>
                  Apply to this voucher
                </Button>
              </form>
            )}
            {candidate && candidate.kind !== "voucher" && (
              <form action={bookingAction}>
                <input type="hidden" name="transfer_id" value={transfer.id} />
                <input type="hidden" name="booking_type" value={candidate.kind} />
                <input type="hidden" name="booking_id" value={candidate.id} />
                <Button type="submit" size="sm" disabled={pending}>
                  Mark this order paid
                </Button>
              </form>
            )}
          </div>
        )}

        <form action={ignoreAction}>
          <input type="hidden" name="transfer_id" value={transfer.id} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Ignore (handled elsewhere)
          </Button>
        </form>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-tarragon-green">{message}</p>}
      </CardContent>
    </Card>
  );
}

export function UnmatchedTransfersManager({ transfers }: { transfers: UnmatchedTransferWithCandidates[] }) {
  if (transfers.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">Nothing waiting — every transfer has been applied automatically.</p>;
  }

  return (
    <div className="space-y-4">
      {transfers.map((t) => (
        <TransferRow key={t.id} transfer={t} />
      ))}
    </div>
  );
}
