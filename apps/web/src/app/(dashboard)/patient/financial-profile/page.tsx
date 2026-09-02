import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { koboToNaira } from "@tarragon/shared";
import { PayMyShareButton } from "./pay-my-share-button";

const ORDER_TYPE_LABEL: Record<string, string> = {
  lab: "lab order",
  pharmacy: "pharmacy order",
  referral: "specialist referral",
};

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const VOUCHER_STATUS_VARIANT: Record<string, "green" | "grey" | "amber" | "red"> = {
  active: "green",
  reserved: "amber",
  redeemed: "grey",
  expired: "grey",
  cancelled: "grey",
};

const REFUND_STATUS_VARIANT: Record<string, "green" | "grey" | "amber" | "red"> = {
  due: "amber",
  refunded: "green",
  failed: "red",
};

/**
 * §91.2 consolidated patient financial profile — the one screen a patient
 * can go to for "what have I paid, what am I on, what's still moving."
 * Pure assembly over data patients already own under RLS: several narrow
 * queries, not one monolithic aggregator RPC, matching this codebase's
 * existing single-purpose-RPC convention. Reuses:
 *   - Phase 1's finance_unified_ledger for transaction history
 *   - care_vouchers (already patient-readable via RLS) for the voucher wallet
 *   - service_purchases (already patient-readable via RLS) for the active
 *     services summary — rewired 2026-09-02 from subscriptions/
 *     subscription_plans, retired by the 2026-08-31 pay-per-service cutover.
 *     Unlike a subscription, a patient can hold several service_purchases
 *     rows active at once (no single "plan"), so this lists every currently
 *     active one instead of picking one.
 *   - Phase 3's voucher_refund_queue (patient-readable as of this phase) for
 *     refunds still in flight
 *
 * "Saved payment method" is deliberately NOT a stored-card display — Paystack
 * and Stripe hosted checkout mean Tarragon never sees or stores a card
 * number, so there is nothing to show beyond which provider last processed a
 * charge.
 */
export default async function FinancialProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    ledgerResult,
    servicePurchasesResult,
    vouchersResult,
    refundsResult,
    failedPaymentResult,
    subsidyShareResult,
  ] = await Promise.all([
      supabase.rpc("finance_unified_ledger", { p_profile_id: user.id, p_limit: 20 }),
      supabase
        .from("service_purchases")
        .select("id, status, payable_kobo, currency, expires_at, service_product:service_products(name)")
        .eq("patient_id", user.id)
        .eq("status", "active")
        .order("purchased_at", { ascending: false })
        .limit(10),
      supabase
        .from("care_vouchers")
        .select("id, voucher_number, sku_name, kind, status, face_value_kobo, amount_paid_kobo, expires_at")
        .eq("beneficiary_profile_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("voucher_refund_queue")
        .select("id, voucher_id, amount_minor, currency, status, provider, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("payment_transactions")
        .select("id, error, created_at")
        .not("error", "is", null)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("subsidy_contributions")
        .select(
          "id, role, amount_minor, transaction_subsidy:transaction_subsidies(order_type, gross_amount_kobo)",
        )
        .eq("payer_profile_id", user.id)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const transactions = ledgerResult.data ?? [];
  const activeServices = servicePurchasesResult.data ?? [];
  const vouchers = vouchersResult.data ?? [];
  const refunds = refundsResult.data ?? [];
  const recentFailures = failedPaymentResult.data ?? [];
  const pendingShares = subsidyShareResult.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your finances</h1>
        <p className="text-charcoal-ink/60">
          Your services, vouchers, transactions, and anything still being refunded — all in one place.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your services</CardTitle>
          </CardHeader>
          <CardContent>
            {activeServices.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No active services yet.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {activeServices.map((service) => (
                  <div key={service.id} className="space-y-1">
                    <p className="font-medium text-charcoal-ink">
                      {service.service_product?.name ?? "Service"}
                    </p>
                    <p className="text-charcoal-ink/70">
                      {naira(service.payable_kobo ?? 0)} {service.currency}
                      {service.expires_at &&
                        ` · runs until ${new Date(service.expires_at).toLocaleDateString("en-NG")}`}
                    </p>
                  </div>
                ))}
                <p className="pt-1">
                  <Link href="/patient/subscription" className="text-xs font-medium text-deep-forest hover:underline">
                    Manage your services →
                  </Link>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent payment issues</CardTitle>
            <CardDescription>
              We never store your card — a failed charge means Paystack declined it, not that
              anything on our side went wrong.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentFailures.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No recent payment problems.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {recentFailures.map((f) => (
                  <li key={f.id} className="text-charcoal-ink/70">
                    {new Date(f.created_at).toLocaleDateString("en-NG")} — {f.error}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {pendingShares.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your share of a split bill</CardTitle>
            <CardDescription>
              Someone supporting you paid part of one of your bills — this is the reduced amount
              left for you to pay yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {pendingShares.map((share) => (
                <li
                  key={share.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/10 pb-2 text-sm last:border-0"
                >
                  <span className="text-charcoal-ink/80">
                    {ORDER_TYPE_LABEL[share.transaction_subsidy?.order_type ?? ""] ?? "bill"} ·{" "}
                    <span className="font-medium text-charcoal-ink">{naira(share.amount_minor)}</span>
                  </span>
                  <PayMyShareButton contributionId={share.id} label="Pay my share" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Care vouchers</CardTitle>
        </CardHeader>
        <CardContent>
          {vouchers.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No vouchers yet.</p>
          ) : (
            <ul className="space-y-2">
              {vouchers.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/10 pb-2 text-sm last:border-0"
                >
                  <span className="text-charcoal-ink/80">
                    {v.sku_name ?? (v.kind === "reward_discount" ? "Reward credit" : "Care voucher")}{" "}
                    <span className="text-charcoal-ink/40">{v.voucher_number}</span>
                    <span className="text-charcoal-ink/40">
                      {" "}
                      · {naira(v.amount_paid_kobo)} of {naira(v.face_value_kobo)}
                    </span>
                  </span>
                  <Badge variant={VOUCHER_STATUS_VARIANT[v.status] ?? "grey"}>{v.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Refunds in progress</CardTitle>
            <CardDescription>Refunds go back to the original card and are processed daily.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {refunds.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/10 pb-2 text-sm last:border-0"
                >
                  <span className="text-charcoal-ink/80">
                    {naira(r.amount_minor)} {r.currency} via {r.provider}
                  </span>
                  <Badge variant={REFUND_STATUS_VARIANT[r.status] ?? "grey"}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transaction history</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">What for</th>
                    <th className="py-2 pr-4 font-medium">To/from</th>
                    <th className="py-2 pr-4 text-right font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.payment_transaction_id ?? t.entry_id} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4">{new Date(t.posted_at).toLocaleDateString("en-NG")}</td>
                      <td className="py-2 pr-4">{t.service_label}</td>
                      <td className="py-2 pr-4">{t.direction === "money_in" ? t.recipient_label : t.payer_label}</td>
                      <td className="py-2 pr-4 text-right">
                        {t.direction === "money_out" ? "−" : ""}
                        {naira(t.amount_minor)}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={t.status === "completed" ? "green" : "red"}>{t.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
