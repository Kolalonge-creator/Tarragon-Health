"use client";

import { useActionState, useState } from "react";
import { useActivePatientPlans, type SubscriptionPlan } from "@/lib/queries/subscription-plans";
import { startCheckout } from "./actions";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { CurrencyTabs } from "@/components/currency-tabs";
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
  // No prior plan to infer from at this point in the flow — always start on NGN.
  const [currency, setCurrency] = useState<Currency>("NGN");

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
      <CurrencyTabs value={currency} onChange={setCurrency} />
      <div className="space-y-3">
        {Array.from(groups.entries()).map(([tierKey, { monthly, yearly }]) => {
          const interval = intervalByTier[tierKey] ?? (monthly ? "monthly" : "yearly");
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
      <p className="text-center text-xs text-charcoal-ink/50">
        You can change or cancel your plan any time from your dashboard.
      </p>
    </form>
  );
}
