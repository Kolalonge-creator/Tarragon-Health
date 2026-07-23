"use client";

import { useState, useActionState } from "react";
import {
  useMyWallet,
  useWalletLedger,
  useActiveSavingsGoal,
  useCreateSavingsGoal,
  useCancelSavingsGoal,
  useMyReferralCode,
  useRedeemReferralCode,
} from "@/lib/queries/wallet";
import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { topUpWallet } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

const ENTRY_LABEL: Record<string, string> = {
  topup: "Top-up",
  sponsor_topup: "Family top-up",
  referral_reward: "Referral reward",
  prevention_reward: "Prevention reward",
  spend: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000];

export function WalletView({ organisationId }: { organisationId: string }) {
  const { data: wallet, isLoading } = useMyWallet();
  const { data: ledger } = useWalletLedger(wallet?.id ?? null);
  const { data: goal } = useActiveSavingsGoal(wallet?.id ?? null);
  const { data: bundles } = useLabCatalogue();
  const createGoal = useCreateSavingsGoal();
  const cancelGoal = useCancelSavingsGoal();
  const { data: referralCode } = useMyReferralCode();
  const redeem = useRedeemReferralCode();

  const [topupState, topupAction, topupPending] = useActionState(topUpWallet, undefined);
  const [amount, setAmount] = useState<number>(2000);
  const [goalBundleId, setGoalBundleId] = useState<string>("");
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selfBookable = (bundles ?? []).filter((b) => b.self_bookable);
  const balance = wallet?.balance_kobo ?? 0;

  return (
    <div className="space-y-6">
      {/* Balance + top-up */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.billing className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Health Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-3xl font-semibold text-charcoal-ink">
              {isLoading ? "…" : `₦${koboToNaira(balance).toLocaleString()}`}
            </p>
            <p className="mt-1 text-xs text-charcoal-ink/60">
              Spendable on any Tarragon care — health checks, labs, medication refills. Money in
              your Health Wallet only ever becomes care; it can&apos;t be cashed out.
            </p>
          </div>

          <form action={topupAction} className="space-y-3">
            <input type="hidden" name="currency" value="NGN" />
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_AMOUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={amount === n}
                  onClick={() => setAmount(n)}
                  className={
                    amount === n
                      ? "rounded-full border border-brand-green bg-brand-green/10 px-4 py-1.5 text-sm font-medium text-deep-forest"
                      : "rounded-full border border-charcoal-ink/15 px-4 py-1.5 text-sm text-charcoal-ink/70 hover:border-charcoal-ink/30"
                  }
                >
                  ₦{n.toLocaleString()}
                </button>
              ))}
              <input
                type="number"
                name="amountNaira"
                min={500}
                step={100}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                aria-label="Top-up amount in naira"
                className="w-28 rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={topupPending || amount < 500}>
              {topupPending ? "Redirecting…" : `Add ₦${amount.toLocaleString()} to wallet`}
            </Button>
            {topupState?.error && <p className="text-xs text-red-600">{topupState.error}</p>}
          </form>
        </CardContent>
      </Card>

      {/* Savings goal — "pay small small" toward a health check */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saving towards your check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {goal ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-charcoal-ink">{goal.name}</p>
                <p className="text-sm text-charcoal-ink/70">
                  ₦{koboToNaira(Math.min(balance, goal.target_kobo)).toLocaleString()} / ₦
                  {koboToNaira(goal.target_kobo).toLocaleString()}
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-charcoal-ink/10">
                <div
                  className="h-full rounded-full bg-brand-green transition-all"
                  style={{ width: `${Math.min(100, Math.round((balance / goal.target_kobo) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-charcoal-ink/60">
                Add any amount, any time — when your balance reaches the target, you can book
                straight from your wallet.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => cancelGoal.mutate({ goalId: goal.id, walletId: wallet!.id })}
              >
                Remove goal
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-charcoal-ink/70">
                Save small-small towards a health check: pick a check, and your wallet tracks
                progress until you can book it.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Choose a check to save for"
                  value={goalBundleId}
                  onChange={(e) => setGoalBundleId(e.target.value)}
                  className="rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
                >
                  <option value="">Choose a check…</option>
                  {selfBookable.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — ₦{koboToNaira(b.price_kobo).toLocaleString()}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!goalBundleId || !wallet || createGoal.isPending}
                  onClick={() => {
                    const bundle = selfBookable.find((b) => b.id === goalBundleId);
                    if (!bundle || !wallet) return;
                    createGoal.mutate({
                      organisationId,
                      walletId: wallet.id,
                      name: bundle.name,
                      panelBundleId: bundle.id,
                      targetKobo: bundle.price_kobo,
                    });
                  }}
                >
                  Start saving
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Referral card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Give ₦2,000, get ₦2,000</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Share your code. When someone joins with it and completes their first paid order or
            subscription, you both get ₦2,000 of wallet credit — spendable on any Tarragon care.
          </p>
          {referralCode && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-soft-sage px-3 py-1.5 font-mono text-sm font-semibold text-deep-forest">
                {referralCode}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(referralCode).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? "Copied!" : "Copy code"}
              </Button>
            </div>
          )}
          <div className="border-t border-charcoal-ink/10 pt-3">
            <p className="text-xs font-medium text-charcoal-ink/70">Joined with someone&apos;s code?</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value)}
                placeholder="Enter code"
                aria-label="Referral code to redeem"
                className="w-36 rounded-md border border-charcoal-ink/15 px-3 py-1.5 font-mono text-sm uppercase"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!redeemInput.trim() || redeem.isPending}
                onClick={() =>
                  redeem.mutate(redeemInput.trim(), {
                    onSuccess: (r) =>
                      setRedeemMessage(
                        r.ok
                          ? "Applied! You'll both get ₦2,000 credit after your first paid order."
                          : (r.error ?? "Could not apply that code.")
                      ),
                    onError: () => setRedeemMessage("Could not apply that code."),
                  })
                }
              >
                Apply
              </Button>
            </div>
            {redeemMessage && <p className="mt-1 text-xs text-charcoal-ink/70">{redeemMessage}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(ledger ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              Nothing yet — your top-ups, rewards, and payments will show here.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {(ledger ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.amount_kobo > 0 ? "green" : "grey"}>
                        {ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}
                      </Badge>
                      <span className="text-xs text-charcoal-ink/60">
                        {new Date(entry.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    {entry.note && <p className="mt-1 text-xs text-charcoal-ink/60">{entry.note}</p>}
                  </div>
                  <p
                    className={
                      entry.amount_kobo > 0
                        ? "text-sm font-semibold text-deep-forest"
                        : "text-sm font-semibold text-charcoal-ink"
                    }
                  >
                    {entry.amount_kobo > 0 ? "+" : "−"}₦
                    {koboToNaira(Math.abs(entry.amount_kobo)).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
