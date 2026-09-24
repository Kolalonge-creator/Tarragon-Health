"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  useRequestPurchaseGuaranteeRefund,
  type GuaranteeClaim,
  type RequestGuaranteeRefundResult,
} from "@/lib/queries/purchase-guarantee";

const CLAIM_STATUS_BADGE: Record<GuaranteeClaim["status"], { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Refund requested" },
  approved: { variant: "green", label: "Refund approved" },
  denied: { variant: "grey", label: "Refund declined" },
};

// A friendly, brand-voice line for every reason the RPC can refuse a
// request with — never the raw reason code, and never fear-based/urgent
// wording (see CLAUDE.md's Brand section). Eligibility itself is entirely
// server-derived; this only translates what came back.
const REFUSAL_COPY: Record<Exclude<RequestGuaranteeRefundResult, { ok: true }>["reason"], string> = {
  not_found: "We could not find that purchase on your account.",
  not_refundable_status: "This purchase is not in a state we can refund right now.",
  not_eligible_provider:
    "This guarantee covers purchases paid with your own card or platform credit. This one was not.",
  nothing_paid: "There is nothing to refund on this purchase.",
  window_expired: "This purchase is outside the 30-day guarantee window.",
  not_first_purchase: "This guarantee applies to your very first purchase only.",
  already_claimed: "You have already requested a refund for this purchase.",
};

/**
 * "Request a refund" for one service purchase, per the first-purchase
 * money-back guarantee. Every refund goes through a pending-claim →
 * admin-decides flow — this only ever calls
 * request_purchase_guarantee_refund, never decide_purchase_guarantee_refund.
 * Eligibility (first-ever purchase, 30-day window, card/platform-credit
 * paid) is entirely server-derived: this button is offered on every
 * active/expired purchase and simply reports back whatever reason the RPC
 * gives, rather than guessing eligibility client-side first.
 */
export function RequestRefundButton({
  servicePurchaseId,
  existingClaim,
}: {
  servicePurchaseId: string;
  existingClaim: GuaranteeClaim | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const requestRefund = useRequestPurchaseGuaranteeRefund();
  const [result, setResult] = useState<RequestGuaranteeRefundResult | null>(null);

  if (existingClaim) {
    const badge = CLAIM_STATUS_BADGE[existingClaim.status] ?? CLAIM_STATUS_BADGE.pending;
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  }

  function close() {
    setOpen(false);
    setReason("");
    setResult(null);
    requestRefund.reset();
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Request a refund
      </Button>
      <ConfirmDialog
        open={open}
        title="Request a refund"
        description="Covered by our 30-day money-back guarantee on your first purchase. Tell us why if you'd like; an admin reviews every request."
        confirmLabel={requestRefund.isPending ? "Sending…" : "Send request"}
        confirmDisabled={requestRefund.isPending || (result?.ok ?? false)}
        cancelLabel="Close"
        onCancel={close}
        onConfirm={() => {
          requestRefund.mutate(
            { servicePurchaseId, reason: reason.trim() || undefined },
            {
              onSuccess: (data) => {
                setResult(data);
                if (data.ok) {
                  setTimeout(close, 1200);
                }
              },
            },
          );
        }}
      >
        {!result?.ok && (
          <div className="space-y-1">
            <Label htmlFor={`refund-reason-${servicePurchaseId}`} className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Reason (optional)
            </Label>
            <Textarea
              id={`refund-reason-${servicePurchaseId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="What made you want a refund?"
            />
          </div>
        )}
        {result && !result.ok && (
          <p className="text-xs text-red-600 dark:text-red-300">{REFUSAL_COPY[result.reason]}</p>
        )}
        {result && result.ok && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Request sent. We&apos;ll let you know once it&apos;s reviewed.
          </p>
        )}
        {requestRefund.isError && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {(requestRefund.error as Error)?.message ?? "Could not send that request."}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
