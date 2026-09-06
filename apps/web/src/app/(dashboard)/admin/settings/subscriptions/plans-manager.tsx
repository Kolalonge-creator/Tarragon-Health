"use client";

import { useAllSubscriptionPlansAdmin, type SubscriptionPlan } from "@/lib/queries/subscription-plans";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.price_minor === 0) return "Free";
  const currency = plan.currency as Currency;
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(plan.price_minor, currency).toLocaleString()}/${plan.interval === "yearly" ? "year" : "month"}`;
}

/**
 * Read-only history of the retired subscription plans.
 *
 * Everything that wrote from this screen is gone: creating a plan, cloning
 * one, activating one, and "Sync to Paystack" all pointed at a model the
 * platform no longer sells, and the sync in particular created real recurring
 * Plan objects at Paystack that no patient checkout could ever charge
 * against. The rows are kept visible because they are the record of what was
 * charged, and because the provider references below are what someone needs
 * in order to disable those Plans in the Paystack dashboard by hand.
 */
export function PlansManager() {
  const { data: plans, isLoading, isError } = useAllSubscriptionPlansAdmin();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>
          Historical record only. These plans were retired in the 2026-09-02 move to a free app
          with per-service pricing, and nothing here can be edited.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load plans.</p>}
        {plans && plans.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No plans on record.</p>
        )}
        {plans && plans.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {plans.map((plan) => (
              <li key={plan.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {plan.name} <span className="text-charcoal-ink/40">· {plan.code}</span>
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    {formatPrice(plan)}
                    {plan.features.length > 0 && ` · ${plan.features.join(", ")}`}
                  </p>
                  {(plan.paystack_plan_code || plan.stripe_price_id) && (
                    <p className="mt-1 font-mono text-xs text-charcoal-ink/45">
                      {plan.paystack_plan_code && `Paystack ${plan.paystack_plan_code}`}
                      {plan.paystack_plan_code && plan.stripe_price_id && " · "}
                      {plan.stripe_price_id && `Stripe ${plan.stripe_price_id}`}
                    </p>
                  )}
                </div>
                <Badge variant={plan.is_active ? "amber" : "grey"}>
                  {plan.is_active ? "Still flagged active" : "Retired"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
