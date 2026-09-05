"use client";

import { useState } from "react";
import {
  useServiceProductCoachCaps,
  useSetProductDailyLimit,
} from "@/lib/queries/service-product-coach-caps";
import { productDailyLimitSchema } from "@/lib/validation/service-product-coach-caps";
import { koboToNaira, CURRENCY } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function formatPrice(priceMinor: number, currency: string): string {
  if (priceMinor === 0) return "Free";
  const symbol = currency === CURRENCY.NGN ? "₦" : currency === CURRENCY.GBP ? "£" : "$";
  const amount = currency === CURRENCY.NGN ? koboToNaira(priceMinor) : priceMinor / 100;
  return `${symbol}${amount.toLocaleString()}`;
}

/**
 * Gives each buyable service its own AI Coach daily message allowance.
 *
 * The coach itself is not gated by what a patient has bought:
 * private.patient_has_feature_access() returns true for 'ai_coach'
 * unconditionally. What a purchase can change is the daily message cap, which
 * public.get_ai_coach_daily_limit() resolves from the highest
 * ai_coach_daily_limit across the patient's ACTIVE service_purchases, behind a
 * patient-specific rule and ahead of the org-wide default.
 *
 * The list used to name the retired Prevent / Essential / Complete packs. Those
 * products are inactive and cannot be bought, so a cap on one could never take
 * effect; only active products are listed now.
 */
export function ServiceCapsManager() {
  const { data: products, isLoading, isError } = useServiceProductCoachCaps();
  const setLimit = useSetProductDailyLimit();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !products) {
    return <p className="text-sm text-red-600">Could not load service products.</p>;
  }

  const mutationError = (setLimit.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function save(productId: string, raw: string) {
    const parsed = productDailyLimitSchema.safeParse(raw);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setLimit.mutate({ productId, dailyLimit: parsed.data });
    setInputs((prev) => ({ ...prev, [productId]: "" }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily cap by service bought</CardTitle>
        <CardDescription>
          Every patient can use the coach. What a purchase changes is how many messages a day it
          allows. A patient-specific or org-wide override above still wins over anything set here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {displayError && <p className="text-sm text-red-600">{displayError}</p>}
        {products.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No services are currently on sale.</p>
        )}
        <ul className="divide-y divide-charcoal-ink/10">
          {products.map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{product.name}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {formatPrice(product.price_kobo, product.currency)},{" "}
                  {product.ai_coach_daily_limit
                    ? `${product.ai_coach_daily_limit} messages/day`
                    : "no cap set (falls back to the org-wide/default cap)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  placeholder={
                    product.ai_coach_daily_limit ? String(product.ai_coach_daily_limit) : "e.g. 20"
                  }
                  value={inputs[product.id] ?? ""}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [product.id]: e.target.value }))
                  }
                  className="w-24"
                />
                <Button
                  size="sm"
                  disabled={setLimit.isPending || !inputs[product.id]}
                  onClick={() => save(product.id, inputs[product.id])}
                >
                  Save
                </Button>
                {product.ai_coach_daily_limit != null && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setLimit.isPending}
                    onClick={() => setLimit.mutate({ productId: product.id, dailyLimit: null })}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
