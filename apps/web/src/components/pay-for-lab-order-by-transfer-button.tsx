"use client";

import { useActionState, useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { payForLabOrderByTransfer } from "@/app/(dashboard)/patient/lab-tests/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { koboToNaira } from "@tarragon/shared";

// A plain helper, not a hook — kept separate so the Date.now() read isn't
// inlined into useCountdownSeconds' own body, same pattern as formatDob()
// in emergency-card-body.tsx.
function computeSecondsLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/**
 * Derives seconds-remaining from expiresAt at render time rather than
 * storing it in state — the effect only forces a re-render every second
 * (via forceTick, called from the interval callback, not synchronously in
 * the effect body) so the derived value stays fresh.
 */
function useCountdownSeconds(expiresAt: string | undefined): number | null {
  const [, forceTick] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(forceTick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return computeSecondsLeft(expiresAt);
}

/**
 * Pay with Transfer alternative to PayForLabOrderButton's card redirect —
 * sits alongside it in the same "waiting on payment" card, same pattern as
 * RedeemVoucherButton. Unlike the redirect flow, the patient never leaves
 * this page, so there's no callback-URL round trip to pick payment
 * confirmation back up from — paystack-webhook's charge.success (the sole
 * source of truth for activation, never this component) is instead picked
 * up here by polling the order's own status. See
 * docs/PAYSTACK_PAY_WITH_TRANSFER_SPEC.md §10.
 */
export function PayForLabOrderByTransferButton({
  orderId,
  amountKobo,
}: {
  orderId: string;
  amountKobo: number;
}) {
  const [state, formAction, pending] = useActionState(payForLabOrderByTransfer, undefined);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();

  const details = state && !("error" in state) ? state : null;
  const secondsLeft = useCountdownSeconds(details?.expiresAt);
  const expired = details != null && secondsLeft === 0;

  useEffect(() => {
    if (!details || confirmed) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("lab_orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (data?.status === "payment_confirmed") {
        setConfirmed(true);
        router.refresh();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [details, confirmed, orderId, router]);

  if (confirmed) {
    return (
      <p className="pt-1">
        <Badge variant="green">Payment received</Badge>
      </p>
    );
  }

  if (!details || expired) {
    return (
      <form action={formAction} className="pt-1">
        <input type="hidden" name="orderId" value={orderId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending
            ? "Generating account…"
            : expired
              ? "Generate a new account number"
              : "Pay by bank transfer"}
        </Button>
        {state && "error" in state && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
      </form>
    );
  }

  const minutes = Math.floor((secondsLeft ?? 0) / 60);
  const seconds = String((secondsLeft ?? 0) % 60).padStart(2, "0");

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-slate-50 p-3">
      <p className="text-xs text-charcoal-ink/70">
        Transfer exactly <strong>₦{koboToNaira(amountKobo).toLocaleString()}</strong> to:
      </p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 text-sm font-semibold text-charcoal-ink">
          {details.accountNumber}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(details.accountNumber);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-charcoal-ink/70">{details.bankName}</p>
      <p className="text-xs text-charcoal-ink/60">
        Expires in {minutes}:{seconds} — a wrong amount or a missed window is refunded automatically
        rather than retried, so generate a new account number instead of transferring to this one
        again after it expires.
      </p>
    </div>
  );
}
