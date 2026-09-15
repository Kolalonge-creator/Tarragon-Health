"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { koboToNaira, type Enums } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * What each paid product earns, and the clinician rates that answer depends on.
 *
 * This exists because laboratory pricing on this platform was guarded and
 * doctor time was not: private.assert_test_price_covers_cost and
 * enforce_lab_order_not_below_cost both refuse a below-cost test, while whether
 * ₦2,500 for a written clinical answer cleared its delivery cost was not merely
 * unproven but unknowable, because no number existed anywhere to check against.
 *
 * THE HONESTY RULE THIS PAGE HAS TO KEEP. The seeded rates are market
 * ESTIMATES, not payroll, and every figure derived from them is therefore
 * indicative. While any rate carries is_provisional, that has to be said
 * loudly and on every screen that shows a margin -- a plausible-looking number
 * with no provenance is worse than no number, because it gets quoted.
 *
 * Clearing is_provisional is not cosmetic: public.assert_service_price_covers_cost
 * warns while any rate is provisional and RAISES once none are. So replacing
 * these four figures with real payroll turns the cost floor from advisory into
 * binding, with no code change. That is the intended path, and it is why the
 * editor below sits on the same page as the margins rather than three clicks
 * away in a different console.
 */

type Margin = {
  code: string | null;
  name: string | null;
  price_kobo: number | null;
  delivered_by_tier: string | null;
  expected_minutes: number | null;
  component_count: number | null;
  delivery_cost_kobo: number | null;
  payment_fee_kobo: number | null;
  contribution_kobo: number | null;
  rates_are_provisional: boolean | null;
};

type Rate = {
  doctor_tier: Enums<"doctor_tier">;
  cost_per_minute_kobo: number;
  basis: string;
  is_provisional: boolean;
};

const TIER_LABEL: Record<string, string> = {
  care_coordinator: "Care Coordinator",
  medical_officer: "Medical Officer",
  senior_medical_officer: "Senior Medical Officer",
  chief_medical_officer: "Chief Medical Officer",
};

function useMargins() {
  return useQuery({
    queryKey: ["service-margins"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("service_product_margins").select("*");
      if (error) throw error;
      return data as Margin[];
    },
  });
}

function useRates() {
  return useQuery({
    queryKey: ["clinical-tier-cost-rates"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_tier_cost_rates")
        .select("*")
        .order("cost_per_minute_kobo", { ascending: true });
      if (error) throw error;
      return data as Rate[];
    },
  });
}

function useSaveRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tier,
      monthlyNaira,
      confirmed,
    }: {
      tier: Enums<"doctor_tier">;
      monthlyNaira: number;
      confirmed: boolean;
    }) => {
      const supabase = createClient();
      // Same derivation the migration documented, kept here so the number in
      // the box means what the person typing it thinks it means: fully-loaded
      // monthly cost, x1.3 for employer on-costs, over 7,920 productive
      // clinical minutes a month (22 days x 6 hours).
      const perMinuteKobo = Math.round((monthlyNaira * 100 * 1.3) / 7920);
      const { error } = await supabase
        .from("clinical_tier_cost_rates")
        .update({
          cost_per_minute_kobo: perMinuteKobo,
          is_provisional: !confirmed,
          basis: confirmed
            ? `Payroll: ₦${monthlyNaira.toLocaleString("en-NG")}/month × 1.3 on-costs ÷ 7,920 productive minutes. Entered from real figures.`
            : `Estimate: ₦${monthlyNaira.toLocaleString("en-NG")}/month × 1.3 on-costs ÷ 7,920 productive minutes.`,
          updated_at: new Date().toISOString(),
        })
        .eq("doctor_tier", tier);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clinical-tier-cost-rates"] });
      void queryClient.invalidateQueries({ queryKey: ["service-margins"] });
    },
  });
}

function RateRow({ rate }: { rate: Rate }) {
  const save = useSaveRate();
  // Reverse the derivation so the field shows a monthly salary, which is the
  // number an employer actually knows, rather than kobo per minute.
  const impliedMonthly = Math.round((rate.cost_per_minute_kobo * 7920) / 1.3 / 100);
  const [monthly, setMonthly] = useState(String(impliedMonthly));

  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
            {TIER_LABEL[rate.doctor_tier] ?? rate.doctor_tier}
          </p>
          {rate.is_provisional ? (
            <Badge variant="amber">Estimate</Badge>
          ) : (
            <Badge variant="green">From payroll</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-charcoal-ink/55 dark:text-night-ink/55">
          ₦{(rate.cost_per_minute_kobo / 100).toFixed(2)} a minute · {rate.basis}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`rate-${rate.doctor_tier}`} className="text-xs">
            Cost per month (₦)
          </Label>
          <Input
            id={`rate-${rate.doctor_tier}`}
            inputMode="numeric"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
            className="h-9 w-36"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={save.isPending || !monthly}
          onClick={() =>
            save.mutate({ tier: rate.doctor_tier, monthlyNaira: Number(monthly), confirmed: false })
          }
        >
          Save as estimate
        </Button>
        <Button
          size="sm"
          disabled={save.isPending || !monthly}
          onClick={() =>
            save.mutate({ tier: rate.doctor_tier, monthlyNaira: Number(monthly), confirmed: true })
          }
        >
          Save as payroll
        </Button>
      </div>
    </li>
  );
}

export function ServiceMarginsClient() {
  const { data: margins, isLoading, isError } = useMargins();
  const { data: rates } = useRates();

  const provisional = (rates ?? []).some((rate) => rate.is_provisional);
  const sorted = [...(margins ?? [])].sort(
    (a, b) => (a.contribution_kobo ?? 0) - (b.contribution_kobo ?? 0)
  );

  const naira = (kobo: number | null) =>
    kobo === null ? "—" : `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;

  return (
    <div className="space-y-6">
      {provisional ? (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/25">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            These margins are indicative, not real
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/85 dark:text-amber-200/85">
            At least one clinician rate below is still a market estimate rather than payroll, so
            every figure on this page is derived from a guess. Replace them with real numbers and
            save them as payroll. Doing that also turns the cost floor from advisory into binding:
            while any rate is an estimate, a product priced below its modelled cost only warns.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border-l-4 border-brand-green bg-brand-green/[0.07] p-4">
          <p className="text-sm font-medium text-deep-forest dark:text-brand-green-bright">
            The cost floor is binding
          </p>
          <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/80 dark:text-night-ink/80">
            Every rate comes from payroll, so a product priced below its delivery cost is now
            refused rather than flagged.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What a minute of clinical time costs</CardTitle>
          <CardDescription>
            Enter the fully-loaded monthly cost of each tier. We add 30% for employer on-costs and
            divide by 7,920 productive clinical minutes a month — 22 working days at six productive
            hours, deliberately below an eight-hour day, because nobody consults for eight hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {(rates ?? []).map((rate) => (
              <RateRow key={rate.doctor_tier} rate={rate} />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contribution by product</CardTitle>
          <CardDescription>
            Thinnest first. Delivery cost is modelled clinical time; the fee is Paystack&apos;s, and
            it steps up above ₦2,500 because their flat ₦100 is waived at or below that.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
          )}
          {isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Could not load the margins.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/15 text-left text-xs uppercase tracking-wide text-charcoal-ink/55 dark:border-night-ink/20 dark:text-night-ink/55">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 text-right font-medium">Price</th>
                  <th className="py-2 pr-3 text-right font-medium">Delivery</th>
                  <th className="py-2 pr-3 text-right font-medium">Fee</th>
                  <th className="py-2 pr-3 text-right font-medium">Contribution</th>
                  <th className="py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const pct =
                    row.price_kobo && row.contribution_kobo !== null
                      ? Math.round((row.contribution_kobo / row.price_kobo) * 100)
                      : null;
                  const thin = pct !== null && pct < 35;
                  return (
                    <tr
                      key={row.code ?? row.name ?? ""}
                      className="border-b border-charcoal-ink/8 last:border-0 dark:border-night-ink/12"
                    >
                      <td className="py-2 pr-3">
                        <span className="text-charcoal-ink dark:text-night-ink">{row.name}</span>
                        <span className="block text-xs text-charcoal-ink/45 dark:text-night-ink/45">
                          {row.delivered_by_tier}
                          {row.expected_minutes ? ` · ${row.expected_minutes} min` : ""}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{naira(row.price_kobo)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-charcoal-ink/70 dark:text-night-ink/70">
                        {naira(row.delivery_cost_kobo)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-charcoal-ink/50 dark:text-night-ink/50">
                        {naira(row.payment_fee_kobo)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {naira(row.contribution_kobo)}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          (row.contribution_kobo ?? 0) < 0
                            ? "font-medium text-red-600 dark:text-red-400"
                            : thin
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-charcoal-ink/70 dark:text-night-ink/70"
                        }`}
                      >
                        {pct === null ? "—" : `${pct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
