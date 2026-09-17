"use client";

import { useActionState, useState } from "react";
import { payForPharmacyOrder } from "@/app/(dashboard)/patient/pharmacy/actions";
import { PromoCodeField } from "@/components/promo-code-field";
import { PriceBreakdownConfirm } from "@/components/billing/price-breakdown-confirm";
import { orderBreakdown } from "@/lib/billing/price-breakdown";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  useMyPlatformCreditBalance,
  usePayPharmacyOrderWithCredit,
  type PayPharmacyOrderWithCreditResult,
} from "@/lib/queries/platform-credit";
import { koboToNaira } from "@tarragon/shared";

/**
 * "Pay with Platform Credit" — same enough/short-balance UX as
 * BuyServiceDialog (apps/web/.../patient/subscription/buy-service-dialog.tsx):
 * cost shown up front, confirming pays it straight out of the caller's
 * platform_credit_balances row with no Paystack redirect at all; short on
 * balance, it says exactly how much more is needed and links to the top-up
 * card instead of offering a button that would just fail server-side.
 *
 * A local, pharmacy-scoped version rather than a shared component — no
 * `apps/web/src/components/pay-with-credit-or-card.tsx` existed yet at the
 * time this was built.
 */
function PayWithPlatformCreditDialog({
  patientId,
  orderId,
  amountKobo,
  trigger,
}: {
  patientId: string;
  orderId: string;
  amountKobo: number;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: balance } = useMyPlatformCreditBalance(patientId);
  const payWithCredit = usePayPharmacyOrderWithCredit();
  const [result, setResult] = useState<PayPharmacyOrderWithCreditResult | null>(null);

  const balanceKobo = balance?.balance_kobo ?? 0;
  const hasEnoughCredit = balanceKobo >= amountKobo;
  const shortfallKobo = Math.max(0, amountKobo - balanceKobo);

  function close() {
    setOpen(false);
    payWithCredit.reset();
    setResult(null);
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <ConfirmDialog
        open={open}
        title="Pay for this pharmacy order"
        description={hasEnoughCredit ? "Pay for this from your platform credit balance." : undefined}
        confirmLabel={
          payWithCredit.isPending ? "Paying…" : hasEnoughCredit ? "Pay with credit" : "Top up first"
        }
        confirmDisabled={payWithCredit.isPending || !hasEnoughCredit}
        cancelLabel="Close"
        onCancel={close}
        onConfirm={() => {
          if (!hasEnoughCredit) return;
          payWithCredit.mutate(
            { patientId, pharmacyOrderId: orderId },
            {
              onSuccess: (data) => {
                setResult(data);
                if (data.ok) setTimeout(close, 1200);
              },
            },
          );
        }}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Cost", value: `₦${koboToNaira(amountKobo).toLocaleString()}` },
            { label: "Your platform credit", value: `₦${koboToNaira(balanceKobo).toLocaleString()}` },
            hasEnoughCredit
              ? { label: "Balance after", value: `₦${koboToNaira(balanceKobo - amountKobo).toLocaleString()}` }
              : { label: "You need", value: `₦${koboToNaira(shortfallKobo).toLocaleString()} more` },
          ]}
        />

        {!hasEnoughCredit && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Your balance is too low for this.{" "}
            <a href="/patient/care#platform-credit" className="underline" onClick={close}>
              Add funds to your platform credit
            </a>{" "}
            and come back, or pay by card below instead.
          </p>
        )}

        {result && !result.ok && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {result.reason === "insufficient_balance"
              ? `You need ₦${koboToNaira(result.shortfall_kobo).toLocaleString()} more.`
              : "This order can no longer be paid for — refresh and try again."}
          </p>
        )}
        {result && result.ok && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">Paid. Your order is confirmed.</p>
        )}
        {payWithCredit.isError && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {(payWithCredit.error as Error)?.message ?? "Could not complete this payment."}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

export function PayForPharmacyOrderButton({
  orderId,
  patientId,
  amountKobo,
  totalKobo,
}: {
  orderId: string;
  /** Needed to look up/spend the caller's platform_credit_balances row. */
  patientId: string;
  amountKobo: number;
  /** The pre-discount catalogue price, if known — see PayForLabOrderButton. */
  totalKobo?: number;
}) {
  const [state, formAction, pending] = useActionState(payForPharmacyOrder, undefined);
  const breakdown = orderBreakdown({
    label: "Pharmacy order",
    totalKobo: totalKobo ?? amountKobo,
    payableKobo: amountKobo,
  });

  return (
    <div className="space-y-1">
      <PayWithPlatformCreditDialog
        patientId={patientId}
        orderId={orderId}
        amountKobo={amountKobo}
        trigger={
          <Button type="button" size="sm" variant="outline">
            Pay with Platform Credit
          </Button>
        }
      />
      <form action={formAction} className="pt-1">
        <input type="hidden" name="orderId" value={orderId} />
        <PriceBreakdownConfirm
          breakdown={breakdown}
          triggerLabel={`Pay ₦${koboToNaira(amountKobo).toLocaleString()} to confirm`}
          pending={pending}
        />
        {state?.error && <p className="pt-1 text-xs text-red-600 dark:text-red-300">{state.error}</p>}
      </form>
      <PromoCodeField orderId={orderId} orderType="pharmacy" />
    </div>
  );
}
