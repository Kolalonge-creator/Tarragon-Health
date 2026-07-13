"use client";

import { useActionState, useState, useTransition } from "react";
import { useAllAddOnsAdmin, useSetAddOnActive, type AddOn } from "@/lib/queries/add-ons";
import { useAllSubscriptionPlansAdmin } from "@/lib/queries/subscription-plans";
import { createAddOn, syncAddOnNow } from "./actions";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function formatPrice(addOn: AddOn): string {
  const currency = addOn.currency as Currency;
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(addOn.price_minor, currency).toLocaleString()}/${addOn.interval === "yearly" ? "year" : "month"}`;
}

export function AddOnsManager() {
  const { data: addOns, isLoading, isError } = useAllAddOnsAdmin();
  const { data: plans } = useAllSubscriptionPlansAdmin();
  const setActive = useSetAddOnActive();
  const [createState, createAction, createPending] = useActionState(createAddOn, undefined);
  const [syncPending, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{
    code: string;
    name: string;
    description: string;
    price_amount: number;
    currency: Currency;
    interval: string;
    restricted_to_plan_code: string;
    features: string;
  } | null>(null);

  function cloneFrom(addOn: AddOn) {
    const currency = addOn.currency as Currency;
    setPrefill({
      code: "",
      name: `${addOn.name} (copy)`,
      description: addOn.description ?? "",
      price_amount: fromMinorUnits(addOn.price_minor, currency),
      currency,
      interval: addOn.interval,
      restricted_to_plan_code: addOn.restricted_to_plan_code ?? "",
      features: addOn.features.join(", "),
    });
  }

  function handleSync(id: string) {
    startSync(async () => {
      const result = await syncAddOnNow(id);
      setSyncMessage(result?.message ?? result?.error ?? null);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add-ons</CardTitle>
          <CardDescription>
            Same price-lock rule as plans — clone instead of editing price once an add-on has
            active subscribers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load add-ons.</p>}
          {syncMessage && <p className="text-sm text-charcoal-ink/70">{syncMessage}</p>}
          {addOns && (
            <ul className="divide-y divide-charcoal-ink/10">
              {addOns.map((addOn) => (
                <li key={addOn.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {addOn.name} <span className="text-charcoal-ink/40">· {addOn.code}</span>
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {formatPrice(addOn)}
                      {addOn.restricted_to_plan_code && ` · ${addOn.restricted_to_plan_code} plan only`}
                      {addOn.price_locked && " · price locked (has subscribers)"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!addOn.paystack_plan_code && !addOn.stripe_price_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncPending}
                        onClick={() => handleSync(addOn.id)}
                      >
                        Sync to {addOn.currency === "NGN" ? "Paystack" : "Stripe"}
                      </Button>
                    )}
                    <Badge variant={addOn.is_active ? "green" : "grey"}>
                      {addOn.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: addOn.id, isActive: !addOn.is_active })}
                    >
                      {addOn.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => cloneFrom(addOn)}>
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
          <CardTitle>Create an add-on</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="space-y-3" key={prefill?.code ?? "new"}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ao_code">Code</Label>
                <Input id="ao_code" name="code" placeholder="e.g. care-coordinator" defaultValue={prefill?.code} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ao_name">Name</Label>
                <Input id="ao_name" name="name" defaultValue={prefill?.name} required />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ao_description">Description</Label>
                <Input id="ao_description" name="description" defaultValue={prefill?.description} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ao_price_amount">Price</Label>
                <Input
                  id="ao_price_amount"
                  name="price_amount"
                  type="number"
                  min={0}
                  defaultValue={prefill?.price_amount}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ao_currency">Currency</Label>
                <Select id="ao_currency" name="currency" defaultValue={prefill?.currency ?? "NGN"}>
                  <option value="NGN">NGN (Paystack)</option>
                  <option value="USD">USD (Stripe)</option>
                  <option value="GBP">GBP (Stripe)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ao_interval">Interval</Label>
                <Select id="ao_interval" name="interval" defaultValue={prefill?.interval ?? "monthly"}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ao_restricted">Restricted to plan</Label>
                <Select
                  id="ao_restricted"
                  name="restricted_to_plan_code"
                  defaultValue={prefill?.restricted_to_plan_code ?? ""}
                >
                  <option value="">Any paid plan</option>
                  {(plans ?? []).map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name} ({plan.currency})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ao_features">Features (comma-separated)</Label>
                <Input
                  id="ao_features"
                  name="features"
                  placeholder="dedicated_coordinator"
                  defaultValue={prefill?.features}
                />
              </div>
            </div>
            {createState?.error && <p className="text-sm text-red-600">{createState.error}</p>}
            {createState?.message && (
              <p className="text-sm text-charcoal-ink/70">{createState.message}</p>
            )}
            <Button type="submit" disabled={createPending}>
              {createPending ? "Creating…" : "Create add-on"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
