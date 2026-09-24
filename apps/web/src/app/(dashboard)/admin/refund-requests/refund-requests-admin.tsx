"use client";

import { useState } from "react";
import {
  useAdminGuaranteeClaims,
  useDecidePurchaseGuaranteeRefund,
  type AdminGuaranteeClaim,
} from "@/lib/queries/purchase-guarantee-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { formatKobo } from "@/lib/format-money";

type Decision = { claim: AdminGuaranteeClaim; approve: boolean };

function amountKoboFor(claim: AdminGuaranteeClaim): number {
  return claim.service_purchase?.payable_kobo ?? claim.service_purchase?.amount_kobo ?? 0;
}

/**
 * First-purchase money-back guarantee claims, oldest first. Modelled on
 * BookingRequestsAdmin: a real money decision, so Approve/Deny both go
 * through ConfirmDialog rather than a bare button onClick — approving moves
 * real money (a Paystack refund is queued, or a platform credit balance is
 * restored, per decide_purchase_guarantee_refund's own return value).
 */
export function RefundRequestsAdmin() {
  const claims = useAdminGuaranteeClaims();
  const decide = useDecidePurchaseGuaranteeRefund();
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisionRefusal, setDecisionRefusal] = useState<string | null>(null);

  function openDecision(claim: AdminGuaranteeClaim, approve: boolean) {
    setNote("");
    setDecisionRefusal(null);
    setPending({ claim, approve });
  }

  function closeDecision() {
    setPending(null);
    setNote("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending claims</CardTitle>
      </CardHeader>
      <CardContent>
        {claims.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {claims.isError && <p className="text-sm text-red-600">Could not load refund requests.</p>}
        {!claims.isLoading && !claims.isError && claims.data?.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No pending refund requests.</p>
        )}
        {claims.data && claims.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {claims.data.map((claim) => {
              const purchase = claim.service_purchase;
              const isExpanded = expandedId === claim.id;
              return (
                <li key={claim.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        {claim.patient?.full_name ?? "Unknown patient"}{" "}
                        <span className="font-normal text-charcoal-ink/60">
                          → {purchase?.service_product?.name ?? "Service purchase"}
                        </span>
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {formatKobo(amountKoboFor(claim))} · requested {formatPatientDate(claim.requested_at)}
                        {claim.patient?.phone ? ` · ${claim.patient.phone}` : ""}
                        {purchase?.payment_provider ? ` · paid via ${purchase.payment_provider}` : ""}
                      </p>
                      {claim.reason && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : claim.id)}
                          className="text-xs font-medium text-deep-forest hover:underline"
                        >
                          {isExpanded ? "Hide reason" : "Show reason"}
                        </button>
                      )}
                      {isExpanded && claim.reason && (
                        <p className="mt-1 max-w-md text-xs text-charcoal-ink/70">{claim.reason}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={() => openDecision(claim, false)}
                      >
                        Deny
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => openDecision(claim, true)}
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
      </CardContent>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.approve ? "Approve this refund?" : "Deny this refund request?"}
        description={
          pending?.approve
            ? "The patient's card is refunded (or their platform credit balance is restored), and any access this purchase granted is withdrawn."
            : "The patient is told this request was declined. Nothing is refunded."
        }
        confirmLabel={decide.isPending ? "Saving…" : pending?.approve ? "Approve refund" : "Deny request"}
        confirmDisabled={decide.isPending}
        cancelLabel="Go back"
        destructive={!pending?.approve}
        onConfirm={() => {
          const target = pending;
          if (!target) return;
          setDecisionRefusal(null);
          decide.mutate(
            { claimId: target.claim.id, approve: target.approve, note: note.trim() || undefined },
            {
              onSuccess: (data) => {
                // decide_purchase_guarantee_refund can return a soft
                // ok:false (e.g. another admin already decided this claim,
                // or the purchase's status changed underneath it) without
                // throwing — never close the dialog as if the refund went
                // through without checking this.
                if (!data.ok) {
                  setDecisionRefusal(
                    data.reason === "already_decided"
                      ? "Someone already decided this claim. Refresh to see the current status."
                      : `This purchase can no longer be refunded (status: ${data.status ?? "unknown"}).`,
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
                { label: "Patient", value: pending.claim.patient?.full_name ?? "Unknown patient" },
                {
                  label: "Service",
                  value: pending.claim.service_purchase?.service_product?.name ?? "Service purchase",
                },
                { label: "Amount", value: formatKobo(amountKoboFor(pending.claim)) },
              ]}
            />
            <div className="space-y-1">
              <Label htmlFor="decision-note" className="text-xs text-charcoal-ink/60">
                Note (optional, kept with the claim)
              </Label>
              <Textarea
                id="decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Visible only to admins"
              />
            </div>
            {decisionRefusal && <p className="text-xs text-red-600 dark:text-red-300">{decisionRefusal}</p>}
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
