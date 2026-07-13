"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  useCurrentSubscription,
  useAttachedAddOns,
  useAvailableAddOns,
} from "@/lib/queries/subscriptions";
import { useActivePatientPlans, type SubscriptionPlan } from "@/lib/queries/subscription-plans";
import { changePlan, attachAddOn, detachAddOn, cancelSubscription } from "./actions";
import { koboToNaira } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatPrice(priceMinor: number, interval: string): string {
  if (priceMinor === 0) return "Free";
  return `₦${koboToNaira(priceMinor).toLocaleString()}/${interval === "yearly" ? "year" : "month"}`;
}

const STATUS_BADGE: Record<string, { label: string; variant: "green" | "amber" | "red" | "grey" }> = {
  active: { label: "Active", variant: "green" },
  trialing: { label: "Pending payment", variant: "amber" },
  past_due: { label: "Payment failed", variant: "red" },
  cancelled: { label: "Cancelled", variant: "grey" },
};

export function SubscriptionManager() {
  const { data: subscription, isLoading, isError, refetch: refetchSubscription } =
    useCurrentSubscription();
  const { data: addOns, refetch: refetchAddOns } = useAttachedAddOns(subscription?.id);
  const { data: catalogue } = useAvailableAddOns();
  const { data: plans } = useActivePatientPlans();

  const [changeState, changeAction, changePending] = useActionState(changePlan, undefined);
  const [attachState, attachAction, attachPending] = useActionState(attachAddOn, undefined);
  const [pendingId, startTransition] = useTransition();
  const [rowMessage, setRowMessage] = useState<string | null>(null);

  // changePlan's free-plan branch resolves in place (paid plans redirect to
  // Paystack instead, which navigates away and re-fetches naturally) — a
  // successful switch needs an explicit refetch, or the card above keeps
  // showing the old plan/status despite the "Switched to..." message below it.
  useEffect(() => {
    if (changeState?.message) {
      refetchSubscription();
      refetchAddOns();
    }
  }, [changeState, refetchSubscription, refetchAddOns]);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Could not load your subscription.</p>;

  if (!subscription) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No plan on file yet — this shouldn&apos;t happen after onboarding. Contact support if
        this persists.
      </p>
    );
  }

  const status = STATUS_BADGE[subscription.status] ?? { label: subscription.status, variant: "grey" as const };
  const currentPlanCode = subscription.plan?.code ?? null;
  const otherPlans = (plans ?? []).filter((p) => p.code !== currentPlanCode);
  const attachedCodes = new Set((addOns ?? []).map((a) => a.add_on?.code).filter(Boolean));
  const attachableAddOns = (catalogue ?? []).filter(
    (a) =>
      !attachedCodes.has(a.code) &&
      (a.restricted_to_plan_code === null || a.restricted_to_plan_code === currentPlanCode),
  );

  function handleDetach(id: string) {
    startTransition(async () => {
      const result = await detachAddOn(id);
      setRowMessage(result?.message ?? result?.error ?? null);
      refetchAddOns();
    });
  }

  function handleCancel() {
    if (!subscription) return;
    startTransition(async () => {
      const result = await cancelSubscription(subscription.id);
      setRowMessage(result?.message ?? result?.error ?? null);
      refetchSubscription();
    });
  }

  return (
    <div className="space-y-6">
      {rowMessage && <p className="text-sm text-charcoal-ink/70">{rowMessage}</p>}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{subscription.plan?.name ?? "Unknown plan"}</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <CardDescription>
            {subscription.plan
              ? formatPrice(subscription.plan.price_minor, subscription.plan.interval)
              : null}
            {subscription.current_period_end &&
              ` · renews ${new Date(subscription.current_period_end).toLocaleDateString()}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscription.status !== "cancelled" && subscription.plan && subscription.plan.price_minor > 0 && (
            <Button size="sm" variant="outline" disabled={pendingId} onClick={handleCancel}>
              Cancel plan
            </Button>
          )}
        </CardContent>
      </Card>

      {otherPlans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Change plan</CardTitle>
            <CardDescription>
              Switching starts a fresh billing cycle on the new plan — no partial-month credit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {changeState?.error && <p className="text-sm text-red-600">{changeState.error}</p>}
            {changeState?.message && <p className="text-sm text-charcoal-ink/70">{changeState.message}</p>}
            <div className="flex flex-wrap gap-2">
              {otherPlans.map((plan: SubscriptionPlan) => (
                <form key={plan.id} action={changeAction}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <input type="hidden" name="planCode" value={plan.code} />
                  <Button type="submit" size="sm" variant="outline" disabled={changePending}>
                    Switch to {plan.name} ({formatPrice(plan.price_minor, plan.interval)})
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add-on services</CardTitle>
          <CardDescription>Attach optional services to your plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {addOns && addOns.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {addOns.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {row.add_on?.name ?? "Unknown add-on"}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {row.add_on && formatPrice(row.add_on.price_minor, row.add_on.interval)} ·{" "}
                      {STATUS_BADGE[row.status]?.label ?? row.status}
                    </p>
                  </div>
                  {row.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId}
                      onClick={() => handleDetach(row.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {attachState?.error && <p className="text-sm text-red-600">{attachState.error}</p>}
          {attachableAddOns.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No add-ons available for your current plan.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {attachableAddOns.map((addOn) => (
                <form key={addOn.id} action={attachAction}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <input type="hidden" name="addOnCode" value={addOn.code} />
                  <Button type="submit" size="sm" disabled={attachPending}>
                    Add {addOn.name} ({formatPrice(addOn.price_minor, addOn.interval)})
                  </Button>
                </form>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
