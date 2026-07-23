"use client";

import { useActionState } from "react";
import { payForLabOrder } from "@/app/(dashboard)/patient/lab-tests/actions";
import { useMyWallet, useWalletPayOrder } from "@/lib/queries/wallet";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

export function PayForLabOrderButton({ orderId, amountKobo }: { orderId: string; amountKobo: number }) {
  const [state, formAction, pending] = useActionState(payForLabOrder, undefined);
  const { data: wallet } = useMyWallet();
  const walletPay = useWalletPayOrder();

  const walletCovers = !!wallet && wallet.balance_kobo >= amountKobo;

  return (
    <div className="space-y-1 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={formAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="submit" size="sm" disabled={pending || walletPay.isPending}>
            {pending ? "Redirecting…" : `Pay ₦${koboToNaira(amountKobo).toLocaleString()} to confirm`}
          </Button>
        </form>
        {walletCovers && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={walletPay.isPending || pending}
            onClick={() => walletPay.mutate({ orderType: "lab", orderId })}
          >
            {walletPay.isPending
              ? "Paying…"
              : `Pay from wallet (₦${koboToNaira(wallet.balance_kobo).toLocaleString()} available)`}
          </Button>
        )}
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {walletPay.isError && (
        <p className="text-xs text-red-600">Wallet payment failed — try card instead.</p>
      )}
      {walletPay.isSuccess && (
        <p className="text-xs text-deep-forest">Paid from your wallet — booking confirmed.</p>
      )}
    </div>
  );
}
