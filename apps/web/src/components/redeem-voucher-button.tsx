"use client";

import { useState } from "react";
import {
  useMyVouchers,
  useRedeemVoucher,
  voucherCoversOrder,
  type VoucherPayableOrderType,
} from "@/lib/queries/vouchers";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

/**
 * Settles a pending_payment order with a voucher the patient already holds,
 * instead of a card. Sits alongside PayForLabOrderButton and friends.
 *
 * The list is filtered by voucherCoversOrder, which mirrors the RPC's own
 * rule: a prepaid voucher matches only an order for the exact service it was
 * bought for, and a reward voucher is a discount that applies anywhere. The
 * database is the real gate — this filtering only avoids offering a button
 * that would be refused.
 */
export function RedeemVoucherButton({
  orderType,
  orderId,
  patientId,
  panelBundleId,
  payableKobo,
}: {
  orderType: VoucherPayableOrderType;
  orderId: string;
  patientId: string;
  panelBundleId?: string | null;
  payableKobo: number;
}) {
  const { data: vouchers } = useMyVouchers(patientId);
  const redeem = useRedeemVoucher();
  const [error, setError] = useState<string | null>(null);

  const usable = (vouchers ?? []).filter((v) => voucherCoversOrder(v, orderType, panelBundleId));
  if (usable.length === 0 || payableKobo <= 0) return null;

  // Prefer the prepaid voucher that settles this outright over a small
  // discount, so the obvious action is the one that finishes the job.
  const prepaid = usable.find((v) => v.kind === "prepaid_service");
  const chosen = prepaid ?? usable[0];
  const isPrepaid = chosen.kind === "prepaid_service";

  return (
    <div className="pt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={redeem.isPending}
        onClick={() => {
          setError(null);
          redeem.mutate(
            { voucherId: chosen.id, orderType, orderId, patientId },
            {
              onError: (e) =>
                setError(e instanceof Error ? e.message : "Could not use that voucher"),
            },
          );
        }}
      >
        {redeem.isPending
          ? "Using voucher…"
          : isPrepaid
            ? `Use your ${chosen.sku_name ?? "voucher"} (${chosen.voucher_number})`
            : `Apply ₦${koboToNaira(chosen.face_value_kobo).toLocaleString()} reward voucher`}
      </Button>
      {!isPrepaid && (
        <p className="pt-1 text-xs text-slate-500">
          Covers ₦{koboToNaira(Math.min(chosen.face_value_kobo, payableKobo)).toLocaleString()} of
          this order. You pay the rest by card.
        </p>
      )}
      {error && <p className="pt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
