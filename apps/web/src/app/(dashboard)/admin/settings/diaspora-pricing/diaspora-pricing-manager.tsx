"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveDiasporaPricing, type DiasporaPricingState } from "./actions";

export type UsdPlanRow = {
  code: string;
  name: string;
  interval: string;
  currentUsdMajor: number;
  gbpMajor: number | null;
  needsStripeSync: boolean;
};

export function DiasporaPricingManager({
  initialRate,
  rows,
}: {
  initialRate: number;
  rows: UsdPlanRow[];
}) {
  const [rate, setRate] = useState(String(initialRate));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.code, String(r.currentUsdMajor)]))
  );
  const [state, formAction, pending] = useActionState<
    DiasporaPricingState,
    FormData
  >(saveDiasporaPricing, undefined);

  const rateNum = Number(rate);

  const fillFromRate = () => {
    if (!Number.isFinite(rateNum) || rateNum <= 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.gbpMajor !== null) {
          next[r.code] = String(Math.round(r.gbpMajor * rateNum));
        }
      }
      return next;
    });
  };

  const rowsPayload = useMemo(
    () =>
      JSON.stringify(
        rows.map((r) => ({
          code: r.code,
          price_minor: Math.round((Number(values[r.code]) || 0) * 100),
        }))
      ),
    [rows, values]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>USD plans</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="rows" value={rowsPayload} />

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label htmlFor="usd_per_gbp">GBP → USD rate</Label>
              <Input
                id="usd_per_gbp"
                name="usd_per_gbp"
                type="number"
                step="0.0001"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" onClick={fillFromRate}>
              Fill USD from rate
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-charcoal-ink/60">
                  <th className="py-2 pr-4 font-medium">Plan</th>
                  <th className="py-2 pr-4 font-medium">Interval</th>
                  <th className="py-2 pr-4 font-medium">GBP</th>
                  <th className="py-2 pr-4 font-medium">Suggested</th>
                  <th className="py-2 pr-4 font-medium">USD price ($)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const suggested =
                    r.gbpMajor !== null && Number.isFinite(rateNum) && rateNum > 0
                      ? Math.round(r.gbpMajor * rateNum)
                      : null;
                  return (
                    <tr
                      key={r.code}
                      className="border-b border-charcoal-ink/5 align-middle"
                    >
                      <td className="py-2 pr-4">
                        <div className="font-medium text-charcoal-ink">
                          {r.name}
                        </div>
                        <div className="text-xs text-charcoal-ink/50">
                          {r.code}
                          {r.needsStripeSync ? " · needs Stripe sync" : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-charcoal-ink/70">
                        {r.interval}
                      </td>
                      <td className="py-2 pr-4 text-charcoal-ink/70">
                        {r.gbpMajor === null ? "—" : `£${r.gbpMajor}`}
                      </td>
                      <td className="py-2 pr-4 text-charcoal-ink/50">
                        {suggested === null ? "—" : `$${suggested}`}
                      </td>
                      <td className="py-2 pr-4">
                        <Input
                          className="w-28"
                          type="number"
                          min="0"
                          step="1"
                          value={values[r.code] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [r.code]: e.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {state?.error ? (
            <p className="text-sm text-status-red">{state.error}</p>
          ) : null}
          {state?.message ? (
            <p className="text-sm text-brand-green">{state.message}</p>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save diaspora pricing"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
