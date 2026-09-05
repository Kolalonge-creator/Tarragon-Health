"use client";

import { useAllAddOnsAdmin, type AddOn } from "@/lib/queries/add-ons";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatPrice(addOn: AddOn): string {
  const currency = addOn.currency as Currency;
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(addOn.price_minor, currency).toLocaleString()}/${addOn.interval === "yearly" ? "year" : "month"}`;
}

/** Read-only, for the same reasons as PlansManager. */
export function AddOnsManager() {
  const { data: addOns, isLoading, isError } = useAllAddOnsAdmin();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add-ons</CardTitle>
        <CardDescription>
          Historical record only. Add-ons attached to a subscription, so they were retired with
          the plans above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load add-ons.</p>}
        {addOns && addOns.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No add-ons on record.</p>
        )}
        {addOns && addOns.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {addOns.map((addOn) => (
              <li key={addOn.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {addOn.name} <span className="text-charcoal-ink/40">· {addOn.code}</span>
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    {formatPrice(addOn)}
                    {addOn.restricted_to_plan_code && ` · ${addOn.restricted_to_plan_code} plan only`}
                  </p>
                  {(addOn.paystack_plan_code || addOn.stripe_price_id) && (
                    <p className="mt-1 font-mono text-xs text-charcoal-ink/45">
                      {addOn.paystack_plan_code && `Paystack ${addOn.paystack_plan_code}`}
                      {addOn.paystack_plan_code && addOn.stripe_price_id && " · "}
                      {addOn.stripe_price_id && `Stripe ${addOn.stripe_price_id}`}
                    </p>
                  )}
                </div>
                <Badge variant={addOn.is_active ? "amber" : "grey"}>
                  {addOn.is_active ? "Still flagged active" : "Retired"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
