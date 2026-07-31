"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fxReviewMessage, fxReviewStatus } from "@/lib/billing/fx-review";
import { confirmRateReviewed, saveCurrencyRates, type DiasporaPricingState } from "./actions";

export type DerivedRow = {
  code: string;
  name: string;
  interval: string;
  currency: "USD";
  /** The naira price this row is converted from, in kobo. */
  nairaMinor: number;
  /** What it is stored at right now, in pence/cents. */
  currentMinor: number;
  needsSync: boolean;
  isActive: boolean;
};

const SYMBOL: Record<"USD", string> = { USD: "$" };

/** Same arithmetic as private.expected_derived_price_minor, for the preview. */
function derive(nairaMinor: number, rate: number): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(nairaMinor / rate);
}

function money(minor: number, symbol: string) {
  return `${symbol}${(minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function CurrencyRateManager({
  initialUsd,
  updatedAtLabel,
  daysSinceReview,
  rows,
  unlinked,
}: {
  initialUsd: number | null;
  /** Preformatted on the server: a bare toLocaleString() here renders one
   * locale during SSR and another in the browser, which is a real hydration
   * mismatch this codebase has already been bitten by twice. */
  updatedAtLabel: string | null;
  daysSinceReview: number | null;
  rows: DerivedRow[];
  unlinked: { code: string; name: string; isActive: boolean }[];
}) {
  const [usd, setUsd] = useState(initialUsd === null ? "" : String(initialUsd));
  const [state, formAction, pending] = useActionState<DiasporaPricingState, FormData>(
    saveCurrencyRates,
    undefined
  );
  const [confirming, startConfirm] = useTransition();
  const [confirmResult, setConfirmResult] = useState<DiasporaPricingState>(undefined);

  const reviewStatus = fxReviewStatus(daysSinceReview);
  const reviewNeedsAttention = reviewStatus === "due" || reviewStatus === "overdue" || reviewStatus === "never";

  const usdRate = Number(usd);

  const preview = useMemo(
    () =>
      rows.map((r) => {
        const next = derive(r.nairaMinor, usdRate);
        return { ...r, nextMinor: next, changes: next !== null && next !== r.currentMinor };
      }),
    [rows, usdRate]
  );

  const changing = preview.filter((r) => r.changes).length;
  const rateSet = initialUsd !== null;

  return (
    <div className="space-y-6">
      <form action={formAction}>
        <Card>
          <CardHeader>
            <CardTitle>Reference rate</CardTitle>
            <CardDescription>
              How much naira one dollar is worth for pricing. Dollars are the only currency
              Tarragon prices in besides naira. This is yours to set and change whenever you like;
              it is not a live market feed, so a price only moves when you move it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs space-y-1">
              <Label htmlFor="ngn_per_usd">Naira per $1</Label>
              <Input
                id="ngn_per_usd"
                name="ngn_per_usd"
                inputMode="decimal"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
                placeholder="e.g. 1365"
                required
              />
            </div>

            {!rateSet && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                No rate is set yet, so the dollar prices below are still the old
                independently-set ones. Saving a rate replaces every one of them with the
                converted naira price.
              </p>
            )}

            <p className="text-sm text-charcoal-ink/70">
              {changing === 0
                ? "Nothing would change at this rate."
                : `Saving changes ${changing} price${changing === 1 ? "" : "s"}. Each one gets a brand-new Stripe price, because a Stripe price can never be edited after it is created. The old one is retired and the plan switches back on only once its replacement exists.`}
            </p>

            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            {state?.message && <p className="text-sm text-deep-forest">{state.message}</p>}

            <div
              className={`rounded-md p-3 text-sm ${
                reviewStatus === "overdue"
                  ? "bg-red-50 text-red-900"
                  : reviewNeedsAttention
                    ? "bg-amber-50 text-amber-900"
                    : "bg-charcoal-ink/5 text-charcoal-ink/70"
              }`}
            >
              <p className="font-medium">{fxReviewMessage(daysSinceReview)}</p>
              {reviewNeedsAttention && (
                <p className="mt-1">
                  This is not a live market feed, so it only moves when you move it. If the number
                  above is still the one you want, say so and the clock resets. Nothing is charged
                  and no price changes.
                </p>
              )}
              {updatedAtLabel && (
                <p className="mt-1 text-xs opacity-70">Last touched {updatedAtLabel}</p>
              )}
            </div>

            {(confirmResult?.error || confirmResult?.message) && (
              <p
                className={`text-sm ${confirmResult.error ? "text-red-600" : "text-deep-forest"}`}
              >
                {confirmResult.error ?? confirmResult.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || confirming}>
                {pending ? "Saving and rebuilding prices…" : "Save rate and update everywhere"}
              </Button>
              {rateSet && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || confirming}
                  onClick={() =>
                    startConfirm(async () => {
                      setConfirmResult(await confirmRateReviewed());
                    })
                  }
                >
                  {confirming ? "Recording…" : "Still correct, mark as reviewed"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>What these rates produce</CardTitle>
          <CardDescription>
            Every row is its naira price converted. There is no way to set one of these
            individually; the database rejects it.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-left text-charcoal-ink/60">
                <th className="py-2 pr-3 font-medium">Plan or add-on</th>
                <th className="py-2 pr-3 font-medium">Naira price</th>
                <th className="py-2 pr-3 font-medium">Now</th>
                <th className="py-2 pr-3 font-medium">After saving</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.code} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-charcoal-ink">{r.name}</span>{" "}
                    <span className="text-charcoal-ink/50">
                      · {r.currency} · {r.interval}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-charcoal-ink/70">
                    ₦{(r.nairaMinor / 100).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-charcoal-ink/70">
                    {money(r.currentMinor, SYMBOL[r.currency])}
                  </td>
                  <td className="py-2 pr-3">
                    {r.nextMinor === null ? (
                      <span className="text-charcoal-ink/40">set a rate</span>
                    ) : r.changes ? (
                      <span className="font-medium text-deep-forest">
                        {money(r.nextMinor, SYMBOL[r.currency])}
                      </span>
                    ) : (
                      <span className="text-charcoal-ink/40">unchanged</span>
                    )}
                  </td>
                  <td className="py-2">
                    {r.isActive ? (
                      <Badge variant="green">On sale</Badge>
                    ) : r.needsSync ? (
                      <Badge variant="amber">Awaiting Stripe price</Badge>
                    ) : (
                      <Badge variant="grey">Off</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {unlinked.length > 0 && (
        <Card className="border-amber-300/60">
          <CardHeader>
            <CardTitle className="text-base">Not on the single price list</CardTitle>
            <CardDescription>
              These have no naira equivalent, so there is nothing to convert from. They are held
              off sale until you either give them a naira price or retire them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {unlinked.map((u) => (
                <li key={u.code} className="flex items-center gap-2">
                  <span className="text-charcoal-ink">{u.name}</span>
                  <code className="text-xs text-charcoal-ink/50">{u.code}</code>
                  {u.isActive && <Badge variant="red">still on sale</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
