"use client";

import { useActionState, useEffect, useState } from "react";
import { useActivePatientPlans, type SubscriptionPlan } from "@/lib/queries/subscription-plans";
import { startCheckout } from "./actions";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { CurrencyTabs } from "@/components/currency-tabs";
import { DiasporaReadinessNotice } from "@/components/diaspora-readiness-notice";
import { Button } from "@/components/ui/button";

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.price_minor === 0) return "Free";
  const currency = plan.currency as Currency;
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(plan.price_minor, currency).toLocaleString()}/${plan.interval === "yearly" ? "year" : "month"}`;
}

/** Groups the flat subscription_plans rows into one card per tier, with a
 * monthly/yearly toggle where both intervals exist (essential/complete) —
 * pricing.ts sells those two ways, modeled as separate plan rows since
 * subscription_plans has no per-row "annual variant" concept and Paystack
 * Plans are one interval each anyway (see supabase/seed/seed.sql).
 *
 * The "_yearly" segment can sit anywhere in a diaspora code (e.g.
 * "essential_yearly_gbp", not just "essential_yearly") since the currency
 * suffix is appended after it — matching only a trailing "_yearly" here
 * left every GBP/USD yearly row in its own ungrouped, toggle-less card
 * (found while adding ParentCare's gbp/usd yearly variants, which hit the
 * exact same shape). The lookahead strips "_yearly" wherever it appears as
 * a whole segment, not just at the very end. */
function groupByTier(plans: SubscriptionPlan[]) {
  const groups = new Map<string, { monthly?: SubscriptionPlan; yearly?: SubscriptionPlan }>();
  for (const plan of plans) {
    const key = plan.code.replace(/_yearly(?=_|$)/, "");
    const entry = groups.get(key) ?? {};
    if (plan.interval === "yearly") entry.yearly = plan;
    else entry.monthly = plan;
    groups.set(key, entry);
  }
  return groups;
}

export function PlanSelector() {
  const { data: plans, isLoading, isError } = useActivePatientPlans();
  const [state, formAction, pending] = useActionState(startCheckout, undefined);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [intervalByTier, setIntervalByTier] = useState<Record<string, "monthly" | "yearly">>({});
  // No prior plan to infer from at this point in the flow, so always start on NGN.
  const [currency, setCurrency] = useState<Currency>("NGN");

  /**
   * Switching currency clears any selection made under the previous one.
   * Without this, picking "essential" on the NGN tab and then switching to USD
   * left selectedCode pointing at the naira row: no card renders as selected
   * (the cards come from visiblePlans, which is currency-filtered) but the
   * hidden input still carries it and Continue stays enabled, so the buyer
   * checks out in the currency they just switched away from. Diaspora buyers
   * are the only people who touch this tab, so it is their bug specifically.
   */
  function changeCurrency(next: Currency) {
    setCurrency(next);
    setSelectedCode(null);
    setIntervalByTier({});
  }

  // A patient about to pay should never stare at a frozen "Starting…" button
  // with zero feedback. This can't cancel an in-flight server action (no
  // client abort primitive for that), but it guarantees visible, honest
  // feedback plus a real way forward if the request really has stalled.
  const [stuck, setStuck] = useState(false);
  // Reset at the start of every new submission — state-adjust-during-render
  // pattern (matches app-shell.tsx's drawer-close-on-route-change), not a
  // synchronous setState in an effect body.
  const [prevPending, setPrevPending] = useState(pending);
  if (prevPending !== pending) {
    setPrevPending(pending);
    if (pending && stuck) setStuck(false);
  }
  useEffect(() => {
    if (!pending) return;
    // setStuck is called from inside the timer callback, not synchronously
    // in the effect body — the sanctioned pattern (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => setStuck(true), 10_000);
    return () => clearTimeout(timer);
  }, [pending]);

  /**
   * Dollars default to yearly, naira to monthly.
   *
   * A dollar plan is the naira price converted at the reference rate
   * (20260729130000 onward), so the smallest monthly charge is around $2.56.
   * Card processing on a charge that size is a flat fee plus a percentage,
   * which takes roughly an eighth of it, and twelve of those a year is real
   * margin for no added value to anyone. The same plan bought yearly is one
   * charge instead of twelve. This only sets which toggle opens first; monthly
   * is still one tap away, and nothing here is hidden or forced.
   */
  const preferredInterval: "monthly" | "yearly" = currency === "USD" ? "yearly" : "monthly";

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading plans…</p>;
  if (isError || !plans) {
    return <p className="text-sm text-red-600">Could not load plans. Refresh and try again.</p>;
  }

  const visiblePlans = plans.filter((p) => p.code === "free" || p.currency === currency);
  const groups = groupByTier(visiblePlans);
  const selectedPlan = selectedCode ? plans.find((p) => p.code === selectedCode) : undefined;
  const selectedIsPaid = !!selectedPlan && selectedPlan.price_minor > 0;
  const selectedInterval = selectedPlan?.interval === "yearly" ? "year" : "month";

  return (
    <form action={formAction} className="space-y-4">
      <CurrencyTabs value={currency} onChange={changeCurrency} />
      {currency === "USD" && (
        <>
          <DiasporaReadinessNotice />
          <p className="rounded-lg bg-brand-green/5 p-3 text-xs text-charcoal-ink/70">
            Paying from abroad? Yearly is set for you because it is the same price as twelve
            monthly payments with two months taken off, and it is one card charge a year instead
            of twelve. Switch any plan back to monthly below if you would rather.
          </p>
        </>
      )}
      <div className="space-y-3">
        {Array.from(groups.entries()).map(([tierKey, { monthly, yearly }]) => {
          const interval =
            intervalByTier[tierKey] ??
            (preferredInterval === "yearly" && yearly ? "yearly" : monthly ? "monthly" : "yearly");
          const active = interval === "yearly" && yearly ? yearly : (monthly ?? yearly);
          if (!active) return null;
          const isSelected = selectedCode === active.code;

          return (
            <div
              key={tierKey}
              className={`rounded-xl border p-4 ${
                isSelected ? "border-brand-green ring-1 ring-brand-green" : "border-charcoal-ink/10"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedCode(active.code)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <p className="font-heading font-semibold text-charcoal-ink">{active.name}</p>
                  <p className="text-sm font-medium text-brand-green">{formatPrice(active)}</p>
                </div>
                {active.description && (
                  <p className="mt-1 text-sm text-charcoal-ink/60">{active.description}</p>
                )}
              </button>
              {monthly && yearly && (
                <div className="mt-2 flex gap-2 text-xs">
                  <button
                    type="button"
                    className={`rounded-full border px-2.5 py-1 font-medium ${
                      interval === "monthly"
                        ? "border-brand-green bg-brand-green/10 text-brand-green"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink/70"
                    }`}
                    onClick={() => {
                      setIntervalByTier((prev) => ({ ...prev, [tierKey]: "monthly" }));
                      if (isSelected) setSelectedCode(monthly.code);
                    }}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={`rounded-full border px-2.5 py-1 font-medium ${
                      interval === "yearly"
                        ? "border-brand-green bg-brand-green/10 text-brand-green"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink/70"
                    }`}
                    onClick={() => {
                      setIntervalByTier((prev) => ({ ...prev, [tierKey]: "yearly" }));
                      if (isSelected) setSelectedCode(yearly.code);
                    }}
                  >
                    Yearly (2 months free)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <input type="hidden" name="planCode" value={selectedCode ?? ""} />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {selectedIsPaid && (
        <p className="rounded-lg bg-charcoal-ink/5 p-3 text-xs text-charcoal-ink/70">
          {`Your plan renews automatically every ${selectedInterval} until you cancel. Payments aren’t refundable — if you cancel, your plan stays active until the end of the ${selectedInterval} you’ve paid for, then won’t renew.`}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending || !selectedCode}>
        {pending ? "Starting…" : "Continue"}
      </Button>
      {pending && stuck && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          This is taking longer than expected. Nothing has been charged yet: you can wait a
          little longer, or{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => window.location.reload()}
          >
            refresh the page and try again
          </button>
          . If a charge does go through after a refresh, it will show on your Subscription page
          and we&apos;ll never charge you twice for the same plan.
        </p>
      )}
      <p className="text-center text-xs text-charcoal-ink/50">
        You can change or cancel your plan any time from your dashboard.
      </p>
    </form>
  );
}
