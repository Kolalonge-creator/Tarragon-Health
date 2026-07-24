"use client";

import { useActionState, useState } from "react";
import { topUpWallet } from "@/app/(dashboard)/patient/wallet/actions";
import {
  useWalletBalance,
  useWalletLedger,
  useWalletSavingsGoal,
  useCreateSavingsGoal,
  useMyReferralCode,
  useRedeemReferralCode,
} from "@/lib/queries/wallet";
import { useFamilyPlanMembers } from "@/lib/queries/family-plan-members";
import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

const ENTRY_LABEL: Record<string, string> = {
  topup: "Top-up",
  sponsor_topup: "Funded by a family member",
  referral_reward: "Referral reward",
  prevention_reward: "Prevention reward",
  spend: "Spent on care",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * The Health Wallet: one NGN balance that four things feed (self top-up,
 * a family member funding your care, referral credit, prevention rewards)
 * and one thing spends it (Tarragon care — never cashed out). Savings goals
 * are just a named target displayed against the same balance, so "pay small
 * small" toward a health check and prevention rewards naturally add up
 * together.
 */
export function WalletCard({ patientId }: { patientId: string }) {
  const { data: balance } = useWalletBalance(patientId);
  const walletId = balance?.id ?? null;
  const { data: ledger } = useWalletLedger(walletId);
  const { data: savingsGoal } = useWalletSavingsGoal(walletId);
  const { data: familyMembers } = useFamilyPlanMembers();
  const { data: bundles } = useLabCatalogue();
  const { data: referralCode } = useMyReferralCode();

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpState, topUpFormAction, topUpPending] = useActionState(topUpWallet, undefined);

  const createGoal = useCreateSavingsGoal();
  const redeemCode = useRedeemReferralCode();
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemResult, setRedeemResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const ahc = (bundles ?? []).find((b) => b.code === "annual_health_check");
  const balanceKobo = balance?.balance_kobo ?? 0;
  const goalProgressPct = savingsGoal
    ? Math.min(100, Math.round((balanceKobo / savingsGoal.target_kobo) * 100))
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.billing className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Health Wallet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-2xl font-semibold text-charcoal-ink">
            ₦{koboToNaira(balanceKobo).toLocaleString()}
          </p>
          <p className="text-xs text-charcoal-ink/60">
            Spend it on any Tarragon lab test, health check, pharmacy order, or referral fee —
            never cashed out.
          </p>
        </div>

        {savingsGoal && (
          <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-charcoal-ink">{savingsGoal.name}</span>
              <span className="text-charcoal-ink/60">
                ₦{koboToNaira(balanceKobo).toLocaleString()} / ₦
                {koboToNaira(savingsGoal.target_kobo).toLocaleString()}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
              <div
                className="h-full rounded-full bg-brand-green transition-all"
                style={{ width: `${goalProgressPct}%` }}
              />
            </div>
          </div>
        )}

        {!savingsGoal && ahc && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!walletId && createGoal.isPending}
            onClick={() => {
              // get_or_create_wallet_for isn't needed here — a self-goal only
              // needs the wallet to exist, and the first top-up/reward call
              // already lazily creates it; if it truly doesn't exist yet,
              // fall through and let the insert's FK fail loudly instead of
              // silently no-op'ing.
              createGoal.mutate({
                walletId: walletId ?? "",
                name: "Annual Health Check",
                targetKobo: ahc.price_kobo,
                panelBundleId: ahc.id,
              });
            }}
          >
            Save toward your Annual Health Check (₦{koboToNaira(ahc.price_kobo).toLocaleString()})
          </Button>
        )}

        <div>
          {topUpOpen ? (
            <form action={topUpFormAction} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
              <label className="block text-xs font-medium text-charcoal-ink" htmlFor="amountNaira">
                Amount (₦)
              </label>
              <Input id="amountNaira" name="amountNaira" type="number" min={100} step={100} required />

              {familyMembers && familyMembers.length > 0 && (
                <>
                  <label className="block text-xs font-medium text-charcoal-ink" htmlFor="beneficiaryProfileId">
                    Fund
                  </label>
                  <Select id="beneficiaryProfileId" name="beneficiaryProfileId" defaultValue={patientId}>
                    <option value={patientId}>Myself</option>
                    {familyMembers.map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        {m.member?.full_name ?? "Family member"}
                      </option>
                    ))}
                  </Select>
                </>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" disabled={topUpPending}>
                  {topUpPending ? "Redirecting…" : "Continue to pay"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTopUpOpen(false)}>
                  Cancel
                </Button>
              </div>
              {topUpState?.error && <p className="text-xs text-red-600">{topUpState.error}</p>}
            </form>
          ) : (
            <Button type="button" size="sm" onClick={() => setTopUpOpen(true)}>
              Top up
            </Button>
          )}
        </div>

        {ledger && ledger.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
              Recent activity
            </p>
            {ledger.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-xs text-charcoal-ink/80">
                <span>{ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}</span>
                <span className={entry.amount_kobo < 0 ? "text-charcoal-ink/60" : "text-brand-green"}>
                  {entry.amount_kobo < 0 ? "−" : "+"}₦
                  {koboToNaira(Math.abs(entry.amount_kobo)).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
            <NAV_ICON.referral className="h-3.5 w-3.5" strokeWidth={2} />
            Refer a friend
          </p>
          <p className="text-xs text-charcoal-ink/70">
            Share your code — you both get ₦500 wallet credit once they complete their first paid
            order.
          </p>
          {referralCode && (
            <div className="flex items-center gap-2">
              <code className="rounded bg-soft-sage px-2 py-1 text-sm font-semibold text-charcoal-ink">
                {referralCode}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(referralCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Input
              placeholder="Have a code?"
              value={redeemInput}
              onChange={(e) => setRedeemInput(e.target.value)}
              className="h-8 max-w-[10rem] text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!redeemInput || redeemCode.isPending}
              onClick={() => {
                redeemCode.mutate(redeemInput, {
                  onSuccess: (data) => setRedeemResult(data),
                });
              }}
            >
              Apply
            </Button>
          </div>
          {redeemResult && (
            <p className={`text-xs ${redeemResult.ok ? "text-brand-green" : "text-red-600"}`}>
              {redeemResult.ok ? "Code applied — welcome reward on the way." : redeemResult.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
