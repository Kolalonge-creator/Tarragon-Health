import { paystackFetch, type PaystackResult } from "./client";
import type { Enums } from "@tarragon/shared";

type BillingInterval = Enums<"billing_interval">;

/** Paystack's plan `interval` values — only the two this project bills in. */
function toPaystackInterval(interval: BillingInterval): "monthly" | "annually" {
  return interval === "yearly" ? "annually" : "monthly";
}

interface PaystackPlanData {
  plan_code: string;
  name: string;
  amount: number;
  interval: string;
  currency: string;
}

/**
 * Creates a Paystack "Plan" object (their term) for a subscription_plans or
 * add_ons row. Idempotency is the caller's job — pass the row's existing
 * `paystack_plan_code` and skip calling this if it's already set (see
 * `syncPlanToPaystack`), since Paystack has no natural idempotency key for
 * plan creation.
 */
export async function createPaystackPlan(args: {
  name: string;
  amountMinor: number;
  interval: BillingInterval;
  currency: "NGN" | "GBP" | "USD";
}): Promise<PaystackResult<{ planCode: string }>> {
  const result = await paystackFetch<PaystackPlanData>("/plan", {
    method: "POST",
    body: {
      name: args.name,
      amount: args.amountMinor,
      interval: toPaystackInterval(args.interval),
      currency: args.currency,
    },
  });
  if (!result.ok) return result;
  return { ok: true, data: { planCode: result.data.plan_code } };
}

/**
 * Idempotent sync for a single plan/add-on row: no-op if it already has a
 * paystack_plan_code, otherwise creates one. Returns the code to persist —
 * the caller (a server action) is responsible for writing it back to the
 * `subscription_plans`/`add_ons` row, since this module has no DB access.
 */
export async function syncPlanToPaystack(row: {
  paystack_plan_code: string | null;
  name: string;
  price_minor: number;
  interval: BillingInterval;
  currency: "NGN" | "GBP" | "USD";
}): Promise<PaystackResult<{ planCode: string }>> {
  if (row.paystack_plan_code) {
    return { ok: true, data: { planCode: row.paystack_plan_code } };
  }
  // Free (price_minor === 0) plans never get a Paystack Plan — there's
  // nothing to charge, and Paystack's /transaction/initialize is only ever
  // called for paid rows (see actions.ts's Free-tier branch).
  if (row.price_minor === 0) {
    return { ok: false, error: "Free plans do not need a Paystack plan" };
  }
  return createPaystackPlan({
    name: row.name,
    amountMinor: row.price_minor,
    interval: row.interval,
    currency: row.currency,
  });
}
