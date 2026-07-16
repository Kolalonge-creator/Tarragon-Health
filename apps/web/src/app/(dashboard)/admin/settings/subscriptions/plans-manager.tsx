"use client";

import { useActionState, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAllSubscriptionPlansAdmin,
  useSetPlanActive,
  ACTIVE_PLANS_QUERY_KEY,
  ALL_PLANS_QUERY_KEY,
  type SubscriptionPlan,
} from "@/lib/queries/subscription-plans";
import { createPlan, syncPlanNow } from "./actions";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.price_minor === 0) return "Free";
  const currency = plan.currency as Currency;
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(plan.price_minor, currency).toLocaleString()}/${plan.interval === "yearly" ? "year" : "month"}`;
}

export function PlansManager() {
  const { data: plans, isLoading, isError } = useAllSubscriptionPlansAdmin();
  const setActive = useSetPlanActive();
  const queryClient = useQueryClient();
  const [createState, createAction, createPending] = useActionState(createPlan, undefined);
  const [syncPending, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{
    code: string;
    name: string;
    description: string;
    price_amount: number;
    currency: Currency;
    interval: string;
    features: string;
  } | null>(null);

  function cloneFrom(plan: SubscriptionPlan) {
    const currency = plan.currency as Currency;
    setPrefill({
      code: "",
      name: `${plan.name} (copy)`,
      description: plan.description ?? "",
      price_amount: fromMinorUnits(plan.price_minor, currency),
      currency,
      interval: plan.interval,
      features: plan.features.join(", "),
    });
  }

  function handleSync(id: string) {
    startSync(async () => {
      const result = await syncPlanNow(id);
      setSyncMessage(result?.message ?? result?.error ?? null);
      // syncPlanNow is a raw server action (useTransition, not a React Query
      // mutation), so nothing was invalidating the cache after it wrote
      // paystack_plan_code/stripe_price_id/is_active -- the row's badge and
      // "Sync to..." button stayed stale until a full page reload. Found
      // while live-syncing ParentCare's 6 new plan rows: every sync
      // succeeded server-side (confirmed via direct DB checks) but the UI
      // kept showing "Inactive"/the sync button as if nothing had happened.
      queryClient.invalidateQueries({ queryKey: ALL_PLANS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ACTIVE_PLANS_QUERY_KEY });
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            Price/currency/interval become read-only once a plan has an active or trialing
            subscriber — clone it as a new plan to change those.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load plans.</p>}
          {syncMessage && <p className="text-sm text-charcoal-ink/70">{syncMessage}</p>}
          {plans && (
            <ul className="divide-y divide-charcoal-ink/10">
              {plans.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {plan.name} <span className="text-charcoal-ink/40">· {plan.code}</span>
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {formatPrice(plan)}
                      {plan.price_locked && " · price locked (has subscribers)"}
                      {plan.features.length > 0 && ` · ${plan.features.join(", ")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {plan.price_minor > 0 && !plan.paystack_plan_code && !plan.stripe_price_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncPending}
                        onClick={() => handleSync(plan.id)}
                      >
                        Sync to {plan.currency === "NGN" ? "Paystack" : "Stripe"}
                      </Button>
                    )}
                    <Badge variant={plan.is_active ? "green" : "grey"}>
                      {plan.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: plan.id, isActive: !plan.is_active })}
                    >
                      {plan.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => cloneFrom(plan)}>
                      Clone
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a plan</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="space-y-3" key={prefill?.code ?? "new"}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="code">Code</Label>
                <Input id="code" name="code" placeholder="e.g. essential" defaultValue={prefill?.code} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={prefill?.name} required />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" defaultValue={prefill?.description} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price_amount">Price</Label>
                <Input
                  id="price_amount"
                  name="price_amount"
                  type="number"
                  min={0}
                  defaultValue={prefill?.price_amount}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select id="currency" name="currency" defaultValue={prefill?.currency ?? "NGN"}>
                  <option value="NGN">NGN (Paystack)</option>
                  <option value="USD">USD (Stripe)</option>
                  <option value="GBP">GBP (Stripe)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="interval">Interval</Label>
                <Select id="interval" name="interval" defaultValue={prefill?.interval ?? "monthly"}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="features">Features (comma-separated)</Label>
                <Input
                  id="features"
                  name="features"
                  placeholder="chronic, clinician_review, doctor_checkin"
                  defaultValue={prefill?.features}
                />
              </div>
            </div>
            {createState?.error && <p className="text-sm text-red-600">{createState.error}</p>}
            {createState?.message && (
              <p className="text-sm text-charcoal-ink/70">{createState.message}</p>
            )}
            <Button type="submit" disabled={createPending}>
              {createPending ? "Creating…" : "Create plan"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
