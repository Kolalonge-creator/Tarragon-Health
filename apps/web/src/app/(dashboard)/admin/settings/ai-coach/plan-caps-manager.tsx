"use client";

import { useState } from "react";
import { useSubscriptionPlanCaps, useSetPlanDailyLimit } from "@/lib/queries/subscription-plan-caps";
import { planDailyLimitSchema } from "@/lib/validation/subscription-plan-caps";
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

/** Lets admin give each subscription tier (free, standard, premium, family,
 * etc. — just the existing subscription_plans rows) its own AI Coach daily
 * message cap, instead of one flat limit for every patient. Resolution
 * order lives in public.get_ai_coach_daily_limit() (see rate-limit.ts). */
export function PlanCapsManager() {
  const { data: plans, isLoading, isError } = useSubscriptionPlanCaps();
  const setLimit = useSetPlanDailyLimit();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !plans) {
    return <p className="text-sm text-red-600">Could not load subscription plans.</p>;
  }

  const mutationError = (setLimit.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function save(planId: string, raw: string) {
    const parsed = planDailyLimitSchema.safeParse(raw);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setLimit.mutate({ planId, dailyLimit: parsed.data });
    setInputs((prev) => ({ ...prev, [planId]: "" }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily cap by plan</CardTitle>
        <CardDescription>
          Give each subscription tier its own AI Coach daily message allowance. A patient-
          specific or org-wide override above still wins over this if one is set.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {displayError && <p className="text-sm text-red-600">{displayError}</p>}
        <ul className="divide-y divide-charcoal-ink/10">
          {plans.map((plan) => (
            <li key={plan.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{plan.name}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {formatPrice(plan.price_minor, plan.currency)} —{" "}
                  {plan.ai_coach_daily_limit
                    ? `${plan.ai_coach_daily_limit} messages/day`
                    : "no cap set (falls back to the org-wide/default cap)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  placeholder={plan.ai_coach_daily_limit ? String(plan.ai_coach_daily_limit) : "e.g. 20"}
                  value={inputs[plan.id] ?? ""}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [plan.id]: e.target.value }))}
                  className="w-24"
                />
                <Button
                  size="sm"
                  disabled={setLimit.isPending || !inputs[plan.id]}
                  onClick={() => save(plan.id, inputs[plan.id])}
                >
                  Save
                </Button>
                {plan.ai_coach_daily_limit != null && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setLimit.isPending}
                    onClick={() => setLimit.mutate({ planId: plan.id, dailyLimit: null })}
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
