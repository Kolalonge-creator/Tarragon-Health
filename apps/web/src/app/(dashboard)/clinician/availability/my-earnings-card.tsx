"use client";

import { useMyClinicianEarnings } from "@/lib/queries/clinician-earnings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function money(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

/**
 * Self-service consult-fee ledger for a Tier 4/5 contracted doctor —
 * renders nothing for anyone else, since only those two tiers ever accrue a
 * row here (Tiers 1-3 are salaried, docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §4/§8). RLS already scopes clinician_consult_earnings to the caller's own
 * rows, so an empty result here is either "nothing accrued yet" or "not a
 * contracted tier" — both render the same quiet empty state.
 */
export function MyEarningsCard() {
  const { data: earnings, isLoading } = useMyClinicianEarnings();

  if (isLoading || !earnings || earnings.length === 0) {
    return null;
  }

  const totalsByStatus = earnings.reduce<Record<string, { minor: number; currency: string }>>(
    (acc, row) => {
      const entry = acc[row.status] ?? { minor: 0, currency: row.currency };
      entry.minor += row.amount_minor;
      acc[row.status] = entry;
      return acc;
    },
    {}
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>My consult fees</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3">
          {(["accrued", "billed", "paid"] as const).map((status) => {
            const entry = totalsByStatus[status];
            if (!entry) return null;
            return (
              <div key={status} className="flex items-center gap-2">
                <Badge variant={status === "paid" ? "green" : status === "billed" ? "blue" : "amber"}>
                  {status === "accrued" ? "Owed" : status === "billed" ? "Billed" : "Paid"}
                </Badge>
                <span className="text-sm text-charcoal-ink">
                  {money(entry.minor, entry.currency)}
                </span>
              </div>
            );
          })}
        </div>
        <ul className="divide-y divide-charcoal-ink/10">
          {earnings.slice(0, 10).map((row) => (
            <li key={row.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-charcoal-ink/70">
                {new Date(row.accrued_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="text-charcoal-ink">{money(row.amount_minor, row.currency)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
