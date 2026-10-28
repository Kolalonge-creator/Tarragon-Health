import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { formatKobo } from "@/lib/format-money";
import {
  CLASS_LABEL,
  dayRowsSchema,
  dayState,
  exceptionRowsSchema,
  type DayRow,
  type ExceptionRow,
} from "@/lib/finance/settlement-tieout";

export const metadata = { title: "Settlement tie-out" };
export const dynamic = "force-dynamic";

const STATE_LABEL = { clean: "Ties out", exceptions: "Has exceptions", nothing_compared: "Nothing compared" } as const;

async function load(): Promise<{ days: DayRow[]; exceptions: ExceptionRow[] } | "denied" | "failed"> {
  const client = loose(await createClient());
  const [d, e] = await Promise.all([client.rpc("settlement_tieout_overview", { p_days: 30 }), client.rpc("settlement_tieout_exceptions", {})]);
  if (d.error?.code === "42501" || e.error?.code === "42501") return "denied";
  if (d.error || e.error) return "failed";
  const days = dayRowsSchema.safeParse(d.data);
  const exceptions = exceptionRowsSchema.safeParse(e.data);
  return days.success && exceptions.success ? { days: days.data, exceptions: exceptions.data } : "failed";
}

/**
 * S80 gap closure (25.6): the daily Paystack settlement tie-out against our ledger, in three classes. Read only: nothing here posts to the
 * ledger or closes a break. A day that compared nothing is shown as such, never as clean. The comparison itself is the existing reconciliation
 * (S14x); this adds the daily counts and a finance view of its breaks.
 */
export default async function SettlementTieoutPage() {
  const loaded = await load();
  if (loaded === "denied") redirect("/finance");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Settlement tie-out</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Each day, what Paystack settled against what our ledger recorded: matched, settled but missing in our ledger, and paid to us but missing at
          Paystack. For the wider check of orders, payments and refunds see{" "}
          <Link href="/finance/money-reconciliation" className="font-medium text-brand-green hover:underline">Money reconciliation</Link>.
        </p>
      </div>
      {loaded === "failed" ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
          The tie-out could not be loaded. This is a loading problem, not a clean result.
        </p>
      ) : (
        <>
          <section aria-labelledby="days" className="space-y-2">
            <h2 id="days" className="font-heading text-lg font-semibold text-charcoal-ink">Last 30 days</h2>
            {loaded.days.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No day has been compared yet. The daily job is switched off until it is turned on in Go-live, and needs the Paystack settlement fetch to be scheduled.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-ink/15 text-xs uppercase tracking-wide text-charcoal-ink/60">
                      <th className="py-2 pr-3">Day</th>
                      <th className="py-2 pr-3">State</th>
                      <th className="py-2 pr-3">Matched</th>
                      <th className="py-2 pr-3">Missing in ledger</th>
                      <th className="py-2 pr-3">Missing at Paystack</th>
                      <th className="py-2">Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.days.map((d) => (
                      <tr key={d.settlement_date} className="border-b border-charcoal-ink/10">
                        <td className="py-2 pr-3">{d.settlement_date}</td>
                        <td className="py-2 pr-3">{STATE_LABEL[dayState(d)]}</td>
                        <td className="py-2 pr-3">{d.matched_count} ({formatKobo(d.matched_kobo)})</td>
                        <td className="py-2 pr-3">{d.missing_in_ledger_count} ({formatKobo(d.missing_in_ledger_kobo)})</td>
                        <td className="py-2 pr-3">{d.missing_at_paystack_count} ({formatKobo(d.missing_at_paystack_kobo)})</td>
                        <td className="py-2">{d.other_break_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section aria-labelledby="exc" className="space-y-2">
            <h2 id="exc" className="font-heading text-lg font-semibold text-charcoal-ink">Open exceptions ({loaded.exceptions.length})</h2>
            {loaded.exceptions.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No open exceptions.</p>
            ) : (
              <ul className="space-y-2">
                {loaded.exceptions.map((x) => (
                  <li key={x.break_id} className="rounded-lg border border-charcoal-ink/15 p-3 text-sm">
                    <div className="font-medium text-charcoal-ink">{CLASS_LABEL[x.tieout_class] ?? x.tieout_class}</div>
                    <div className="mt-1 text-charcoal-ink/70">
                      <code className="rounded bg-charcoal-ink/5 px-1 text-xs">{x.provider_reference}</code>
                      {x.provider_amount_kobo !== null && <> Paystack {formatKobo(x.provider_amount_kobo)}</>}
                      {x.ledger_amount_kobo !== null && <> Ledger {formatKobo(x.ledger_amount_kobo)}</>}
                      {" "}open for {x.age_hours} hours. {x.detail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-charcoal-ink/60">An administrator explains or closes each exception in the reconciliation queue. Nothing is fixed automatically.</p>
          </section>
        </>
      )}
    </div>
  );
}
