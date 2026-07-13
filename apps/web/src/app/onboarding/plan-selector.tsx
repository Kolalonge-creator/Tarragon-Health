"use client";

import { useActionState, useState } from "react";
import { useActivePatientPlans, type SubscriptionPlan } from "@/lib/queries/subscription-plans";
import { startCheckout } from "./actions";
import { koboToNaira } from "@tarragon/shared";
import { Button } from "@/components/ui/button";

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.price_minor === 0) return "Free";
  return `₦${koboToNaira(plan.price_minor).toLocaleString()}/${plan.interval === "yearly" ? "year" : "month"}`;
}

/** Groups the flat subscription_plans rows into one card per tier, with a
 * monthly/yearly toggle where both intervals exist (essential/complete) —
 * pricing.ts sells those two ways, modeled as separate plan rows since
 * subscription_plans has no per-row "annual variant" concept and Paystack
 * Plans are one interval each anyway (see supabase/seed/seed.sql). */
function groupByTier(plans: SubscriptionPlan[]) {
  const groups = new Map<string, { monthly?: SubscriptionPlan; yearly?: SubscriptionPlan }>();
  for (const plan of plans) {
    const key = plan.code.replace(/_yearly$/, "");
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

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading plans…</p>;
  if (isError || !plans) {
    return <p className="text-sm text-red-600">Could not load plans. Refresh and try again.</p>;
  }

  const groups = groupByTier(plans);

  return (
    <form action={formAction} className="space-y-4">
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
                    className={`rounded-full px-2 py-1 ${
                      interval === "monthly" ? "bg-brand-green/10 text-brand-green" : "text-charcoal-ink/50"
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
                    className={`rounded-full px-2 py-1 ${
                      interval === "yearly" ? "bg-brand-green/10 text-brand-green" : "text-charcoal-ink/50"
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
      <Button type="submit" className="w-full" disabled={pending || !selectedCode}>
        {pending ? "Starting…" : "Continue"}
      </Button>
      <p className="text-center text-xs text-charcoal-ink/50">
        You can change or cancel your plan any time from your dashboard.
      </p>
    </form>
  );
}
