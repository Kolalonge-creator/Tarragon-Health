"use client";

import { useState } from "react";
import { useCreatePartnerLabOrder } from "@/lib/queries/lab-orders";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

/**
 * The one place in the app where Tarragon actually bills a lab test: an
 * opt-in alternative to the default self-arranged path, shown only when
 * bundleIsPartnerBillable() confirms the active contracted partner (Synlab)
 * prices every test in this bundle. Mirrors the expand/confirm shape of
 * request-partner-lab-visit.tsx, the one other opt-in partner path in this
 * codebase — but that one never bills; this one does.
 */
export function PartnerLabBillingOption({
  patientId,
  organisationId,
  panelBundleId,
  screeningScheduleId,
  bundleName,
  priceKobo,
}: {
  patientId: string;
  organisationId: string;
  panelBundleId: string;
  screeningScheduleId?: string;
  bundleName: string;
  priceKobo: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [order, setOrder] = useState<{ id: string; total_kobo: number } | null>(null);
  const createPartnerOrder = useCreatePartnerLabOrder();

  if (order) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-charcoal-ink/60">
          Set up with our lab partner. Pay to confirm and we&apos;ll take it from there.
        </p>
        <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-deep-forest hover:underline"
      >
        Prefer us to arrange this with our contracted lab and bill you directly?
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/50 p-3">
      <p className="text-xs text-charcoal-ink/70">
        We&apos;ll book {bundleName} with our contracted lab partner and charge you ₦
        {koboToNaira(priceKobo).toLocaleString()} now — no separate payment to the lab.
      </p>
      {createPartnerOrder.isError && (
        <p className="text-xs text-red-600">Could not set that up just now. Please try again.</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={createPartnerOrder.isPending}
          onClick={() =>
            createPartnerOrder.mutate(
              { organisationId, patientId, panelBundleId, screeningScheduleId },
              { onSuccess: (data) => setOrder(data) }
            )
          }
        >
          {createPartnerOrder.isPending ? "Setting it up…" : "Set this up"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          Never mind
        </Button>
      </div>
    </div>
  );
}
