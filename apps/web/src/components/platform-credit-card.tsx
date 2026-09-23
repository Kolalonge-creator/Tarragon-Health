"use client";

import { useActionState, useState } from "react";
import { topUpPlatformCredit } from "@/app/(dashboard)/patient/platform-credit/actions";
import {
  useMyPlatformCreditBalance,
  usePlatformCreditConfig,
  useMyPlatformCreditLedger,
  usePlatformCreditTopupsEnabled,
  type PlatformCreditLedgerEntry,
} from "@/lib/queries/platform-credit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PLATFORM_CREDIT_TOPUPS_DISABLED_MESSAGE } from "@/lib/billing/platform-credit-messages";
import { koboToNaira } from "@tarragon/shared";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const ENTRY_LABEL: Record<string, string> = {
  topup: "Added to balance",
  admin_grant: "Credit granted",
  spend: "Spent",
  admin_correction: "Adjustment",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Platform credit: fund your account once, spend it on any service whenever
 * you're ready. Unlike a care voucher (an entitlement to one named service),
 * this is a general-purpose balance — the fal.ai/SaveAI-style model the
 * founder asked for (2026-09-17). Deliberately says so: never expires, never
 * cashed out or transferred, only ever spent on services on this platform.
 */
export function PlatformCreditCard({ patientId }: { patientId: string }) {
  const { data: balance } = useMyPlatformCreditBalance(patientId);
  const { data: config } = usePlatformCreditConfig();
  const { data: ledger } = useMyPlatformCreditLedger(patientId, 10);
  const { data: topupsEnabled } = usePlatformCreditTopupsEnabled();

  const [topUpState, topUpAction, topUpPending] = useActionState(topUpPlatformCredit, undefined);
  const [customOpen, setCustomOpen] = useState(false);
  const [customNaira, setCustomNaira] = useState("");

  const balanceKobo = balance?.balance_kobo ?? 0;
  const promoKobo = balance?.promo_balance_kobo ?? 0;
  const suggested = config?.suggested_amounts_kobo ?? [1000000, 2000000, 5000000, 10000000];
  const minNaira = koboToNaira(config?.min_topup_kobo ?? 100000);
  const maxNaira = koboToNaira(config?.max_topup_kobo ?? 500000000);

  return (
    <Card id="platform-credit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.billing className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Platform credit
        </CardTitle>
        <p className="pt-1 text-sm text-slate-600 dark:text-night-ink/70">
          Fund your account once and use it whenever you buy a service — no need to pay each time
          separately. It stays on your account and never expires, and it can&apos;t be withdrawn or
          transferred: only ever spent here.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-night-ink/15 dark:bg-night-ink/5">
          <p className="text-xs text-slate-500 dark:text-night-ink/60">Your balance</p>
          <p className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
            {naira(balanceKobo)}
          </p>
          {promoKobo > 0 && (
            <p className="pt-1 text-xs text-slate-500 dark:text-night-ink/60">
              Includes {naira(promoKobo)} of promotional credit.
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-night-ink/90">Add to your balance</p>
          {topUpState?.error && (
            <p className="pt-1 text-xs text-red-600 dark:text-red-300">{topUpState.error}</p>
          )}
          {topupsEnabled ? (
            <>
              <div className="flex flex-wrap gap-2 pt-2">
                {suggested.map((amountKobo) => (
                  <form key={amountKobo} action={topUpAction}>
                    <input type="hidden" name="patientId" value={patientId} />
                    <input type="hidden" name="amountNaira" value={koboToNaira(amountKobo)} />
                    <Button type="submit" size="sm" variant="outline" disabled={topUpPending}>
                      {topUpPending ? "…" : naira(amountKobo)}
                    </Button>
                  </form>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCustomOpen(!customOpen)}
                >
                  {customOpen ? "Cancel" : "Custom amount"}
                </Button>
              </div>

              {customOpen && (
                <form action={topUpAction} className="flex items-end gap-2 pt-3">
                  <input type="hidden" name="patientId" value={patientId} />
                  <label className="block text-sm">
                    <span className="text-slate-700 dark:text-night-ink/80">Amount (₦)</span>
                    <Input
                      name="amountNaira"
                      type="number"
                      min={minNaira}
                      max={maxNaira}
                      value={customNaira}
                      onChange={(e) => setCustomNaira(e.target.value)}
                      placeholder={String(minNaira)}
                      className="mt-1"
                      required
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={topUpPending}>
                    {topUpPending ? "Opening checkout…" : "Add funds"}
                  </Button>
                </form>
              )}
            </>
          ) : (
            // platform_credit_topups is off — see
            // 20260922185100_platform_credit_topups_kill_switch.sql. Balance
            // and "Recent activity" below stay fully visible; only the "add
            // funds" affordance is hidden, with a clear, non-alarming
            // explanation rather than a missing button with no context.
            <p className="pt-2 text-sm text-slate-600 dark:text-night-ink/70">
              {PLATFORM_CREDIT_TOPUPS_DISABLED_MESSAGE}
            </p>
          )}
        </div>

        {ledger && ledger.length > 0 && (
          <details className="border-t border-slate-100 pt-4 dark:border-night-ink/10">
            <summary className="cursor-pointer text-sm text-slate-600 dark:text-night-ink/70">
              Recent activity
            </summary>
            <ul className="space-y-2 pt-3">
              {ledger.map((entry: PlatformCreditLedgerEntry) => {
                const isCredit = entry.entry_type === "topup" || entry.entry_type === "admin_grant";
                return (
                  <li key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700 dark:text-night-ink/80">
                      {ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}
                      {entry.description ? (
                        <span className="text-xs text-slate-500 dark:text-night-ink/60">
                          {" "}
                          — {entry.description}
                        </span>
                      ) : null}
                      <span className="block text-xs text-slate-500 dark:text-night-ink/60">
                        {formatDate(entry.created_at)}
                      </span>
                    </span>
                    <span
                      className={
                        isCredit
                          ? "text-sm font-medium text-emerald-700 dark:text-emerald-300"
                          : "text-sm font-medium text-slate-600 dark:text-night-ink/70"
                      }
                    >
                      {isCredit ? "+" : "−"}
                      {naira(entry.amount_kobo ?? 0)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
