"use client";

import { useState } from "react";
import {
  useAdminFailedRefunds,
  useAdminOrderRefunds,
  useDecideOrderRefund,
  useRetryFailedRefund,
} from "@/lib/queries/order-refunds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { formatKobo } from "@/lib/format-money";
import { itemLabel } from "@/lib/commerce/item-label";

export type AdminOrderRefund = {
  id: string;
  order_id: string;
  amount_kobo: number;
  reason: string | null;
  state: string;
  created_at: string;
  order: {
    amount_kobo: number;
    state: string;
    paid_at: string | null;
    catalog_item: { code: string; name_key: string } | null;
    beneficiary: { full_name: string | null; phone: string | null } | null;
  } | null;
  requester: { full_name: string | null } | null;
};

type Decision = { refund: AdminOrderRefund; approve: boolean };

/**
 * Pending v5 order refunds (from the `refunds` table), oldest first.
 * Same Approve/Deny → ConfirmDialog pattern as RefundRequestsAdmin — a real
 * money decision, so neither action is a bare button onClick.
 */
export function OrderRefundsAdmin() {
  const refunds = useAdminOrderRefunds();
  const failed = useAdminFailedRefunds();
  const retry = useRetryFailedRefund();
  const decide = useDecideOrderRefund();
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisionRefusal, setDecisionRefusal] = useState<string | null>(null);

  function openDecision(refund: AdminOrderRefund, approve: boolean) {
    setNote("");
    setDecisionRefusal(null);
    setPending({ refund, approve });
  }

  function closeDecision() {
    setPending(null);
    setNote("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending order refunds</CardTitle>
      </CardHeader>
      <CardContent>
        {refunds.isLoading && <p className="text-sm text-charcoal-ink/60">Loading...</p>}
        {refunds.isError && <p className="text-sm text-red-600">Could not load order refunds.</p>}
        {!refunds.isLoading && !refunds.isError && refunds.data?.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No pending order refunds.</p>
        )}
        {refunds.data && refunds.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {refunds.data.map((refund) => {
              const order = refund.order;
              const isExpanded = expandedId === refund.id;
              return (
                <li key={refund.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        {order?.beneficiary?.full_name ?? "Unknown patient"}{" "}
                        <span className="font-normal text-charcoal-ink/60">
                          &rarr; {itemLabel(order?.catalog_item?.name_key, order?.catalog_item?.code ?? "Order item")}
                        </span>
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {formatKobo(refund.amount_kobo)} &middot; requested{" "}
                        {formatPatientDate(refund.created_at)}
                        {refund.requester?.full_name
                          ? ` · by ${refund.requester.full_name}`
                          : ""}
                      </p>
                      {refund.reason && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : refund.id)}
                          className="text-xs font-medium text-deep-forest hover:underline"
                        >
                          {isExpanded ? "Hide reason" : "Show reason"}
                        </button>
                      )}
                      {isExpanded && refund.reason && (
                        <p className="mt-1 max-w-md text-xs text-charcoal-ink/70">
                          {refund.reason}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={() => openDecision(refund, false)}
                      >
                        Deny
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => openDecision(refund, true)}
                      >
                        Approve refund
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {decide.isError && (
          <p className="mt-2 text-sm text-red-600">
            {(decide.error as Error)?.message ?? "Could not record that decision."}
          </p>
        )}
        {failed.data && failed.data.length > 0 && (
          <section aria-labelledby="failed-refunds" className="mt-6 space-y-2">
            <h3 id="failed-refunds" className="text-sm font-semibold text-charcoal-ink">Refunds that failed at Paystack</h3>
            <p className="text-xs text-charcoal-ink/60">
              Check the Paystack dashboard first, then send it back to the queue. It is never retried automatically.
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {failed.data.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {f.order?.beneficiary?.full_name ?? "Unknown patient"}{" "}
                      <span className="font-normal text-charcoal-ink/60">
                        &rarr; {itemLabel(f.order?.catalog_item?.name_key, f.order?.catalog_item?.code ?? "Order item")}
                      </span>
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {formatKobo(f.amount_kobo)} &middot; {f.attempts} attempt{f.attempts === 1 ? "" : "s"} &middot; {f.last_error_code ?? "no code"}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(f.id)}>
                    Send back to queue
                  </Button>
                </li>
              ))}
            </ul>
            {retry.data && retry.data.result !== "requeued" && (
              <p className="text-xs text-red-600">
                {retry.data.result === "provider_mismatch"
                  ? "The weekly check found Paystack disagreeing with us on this refund. Check the Paystack dashboard first, then resolve the incident."
                  : "It could not be sent back to the queue."}
              </p>
            )}
          </section>
        )}
      </CardContent>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.approve ? "Approve this refund?" : "Deny this refund request?"}
        description={
          pending?.approve
            ? "The patient's payment is refunded and their Member access ends straight away, with no grace period. Open follow-ups are cancelled and a doctor is asked to hand over any open work."
            : "The patient is told this request was declined and is shown the reason you write. Nothing is refunded."
        }
        confirmLabel={
          decide.isPending
            ? "Saving…"
            : pending?.approve
              ? "Approve refund"
              : "Deny request"
        }
        confirmDisabled={decide.isPending || (pending?.approve === false && note.trim().length < 5)}
        cancelLabel="Go back"
        destructive={!pending?.approve}
        onConfirm={() => {
          const target = pending;
          if (!target) return;
          setDecisionRefusal(null);
          decide.mutate(
            {
              refundId: target.refund.id,
              approved: target.approve,
              note: note.trim() || undefined,
            },
            {
              onSuccess: (data) => {
                // The RPC answers 'approved' or 'rejected' on success; anything else is a refusal to show, not a silent close.
                if (data?.result !== "approved" && data?.result !== "rejected") {
                  setDecisionRefusal(
                    data?.result === "already_decided"
                      ? "Someone already decided this refund. Refresh to see the current status."
                      : data?.result === "reason_needed"
                        ? "Write the reason first. The patient is shown it."
                        : "This refund could not be decided. Refresh and try again.",
                  );
                  return;
                }
                closeDecision();
              },
            },
          );
        }}
        onCancel={closeDecision}
      >
        {pending && (
          <>
            <ConfirmDialogFacts
              rows={[
                {
                  label: "Patient",
                  value:
                    pending.refund.order?.beneficiary?.full_name ?? "Unknown patient",
                },
                {
                  label: "Item",
                  value: itemLabel(pending.refund.order?.catalog_item?.name_key, pending.refund.order?.catalog_item?.code ?? "Order item"),
                },
                { label: "Amount", value: formatKobo(pending.refund.amount_kobo) },
              ]}
            />
            <div className="space-y-1">
              <Label htmlFor="order-refund-decision-note" className="text-xs text-charcoal-ink/60">
                {pending.approve ? "Note (optional, kept with the refund)" : "Reason (required, shown to the patient)"}
              </Label>
              <Textarea
                id="order-refund-decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={pending.approve ? "Visible to the patient on their refund" : "Say why, in a sentence the patient can read"}
              />
            </div>
            {decisionRefusal && (
              <p className="text-xs text-red-600 dark:text-red-300">{decisionRefusal}</p>
            )}
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
