"use client";

import { useState } from "react";
import {
  usePayBookingOrderWithWallet,
  useWalletBalance,
  type WalletPayableOrderType,
} from "@/lib/queries/wallet";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

/**
 * Alternative to PayForLabOrderButton/PayForPharmacyOrderButton/
 * PayForReferralButton — pays a pending_payment order straight from the
 * caller's Health Wallet balance via the atomic wallet_pay_booking_order
 * RPC, no Paystack/Stripe redirect. Only rendered where the order is
 * actually the caller's own (RLS + the RPC's own ownership check are the
 * real gate; this is just presentation).
 */
export function PayWithWalletButton({
  orderType,
  orderId,
  amountKobo,
  patientId,
}: {
  orderType: WalletPayableOrderType;
  orderId: string;
  amountKobo: number;
  patientId: string;
}) {
  const { data: balance } = useWalletBalance(patientId);
  const payWithWallet = usePayBookingOrderWithWallet();
  const [error, setError] = useState<string | null>(null);

  const sufficientBalance = (balance?.balance_kobo ?? 0) >= amountKobo;
  if (!balance?.id || !sufficientBalance) return null;

  return (
    <div className="pt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={payWithWallet.isPending}
        onClick={() => {
          setError(null);
          payWithWallet.mutate(
            { orderType, orderId, patientId },
            { onError: (e) => setError(e instanceof Error ? e.message : "Could not pay with wallet") },
          );
        }}
      >
        {payWithWallet.isPending
          ? "Paying…"
          : `Pay ₦${koboToNaira(amountKobo).toLocaleString()} from wallet`}
      </Button>
      {error && <p className="pt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
