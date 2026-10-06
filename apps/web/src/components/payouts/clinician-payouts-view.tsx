import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import { KIND_LABEL } from "@/lib/earnings/earnings";
import { STATE_LABEL, banksSchema, overviewSchema, stateVariant } from "@/lib/payouts/payouts";
import { BankForm, TaxForm } from "./payout-forms";

const day = (value: string): string => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

/** A contracted clinician's payouts: where they are paid, tax details (stored only), the weekly statements and every line in each. */
export async function ClinicianPayoutsView() {
  const supabase = await createClient();
  const res = await supabase.rpc("my_payout_overview");
  if (res.error?.message.includes("payout_not_a_contracted_clinician")) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Payouts</h1>
        <p className="text-sm text-charcoal-ink/70">You are paid by salary, so there are no weekly payouts to show here.</p>
      </div>
    );
  }
  const overview = res.error ? null : overviewSchema.safeParse(res.data);
  const needsBank = !overview?.success || !overview.data.bank?.verified;
  const banksRes = needsBank ? await supabase.functions.invoke("payouts", { body: { action: "banks" } }) : null;
  const banks = banksRes && !banksRes.error ? banksSchema.safeParse(banksRes.data) : null;

  if (!overview?.success) {
    return <p role="alert" className="text-sm text-red-600">Your payouts could not be loaded. This is not the same as having none.</p>;
  }
  const o = overview.data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Payouts</h1>
        <p className="text-sm text-charcoal-ink/60">Each week your unpaid earnings are added up, checked by our finance team and sent to your bank. The amounts here are before any tax.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="pt-4"><p className="text-xs text-charcoal-ink/60">In the next payout</p><p className="text-xl font-semibold">{formatKobo(o.next_payout_kobo)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-charcoal-ink/60">Smallest payout we send</p><p className="text-xl font-semibold">{o.minimum_payout_kobo === null ? "None" : formatKobo(o.minimum_payout_kobo)}</p><p className="text-xs text-charcoal-ink/60">Smaller amounts wait and join the next week.</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Where we pay you</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {o.bank?.verified ? (
            <p className="text-sm">{o.bank.bank_name}, account ending {o.bank.account_last4}, in the name {o.bank.resolved_name}. <Badge variant="green">Verified</Badge></p>
          ) : (
            <p className="text-sm text-charcoal-ink/70">No verified bank account yet. We cannot pay you until you add one in your own name.</p>
          )}
          {banks?.success ? <BankForm banks={banks.data.banks} /> : needsBank || o.bank ? <p className="text-xs text-charcoal-ink/60">The bank list is not available right now. {needsBank ? "Please try again shortly." : ""}</p> : null}
          {o.bank?.verified && <p className="text-xs text-charcoal-ink/60">To change account, add the new one below. Payouts pause until it is verified.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tax details</CardTitle></CardHeader>
        <CardContent><TaxForm initial={o.tax} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your weekly statements</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {o.payouts.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No payouts yet.</p>
          ) : (
            o.payouts.map((p) => (
              <details key={p.id} className="border-b border-charcoal-ink/10 pb-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span>Up to {day(p.period_end)}</span>
                  <span className="font-semibold">{formatKobo(p.amount_kobo)}</span>
                  <Badge variant={stateVariant(p.state)}>{STATE_LABEL[p.state] ?? p.state}</Badge>
                </summary>
                <ul className="mt-2 space-y-1">
                  {p.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span>{day(l.earned_at)}: {KIND_LABEL[l.kind] ?? l.kind}{l.task_type ? ` (${l.task_type.replaceAll("_", " ")})` : ""}</span>
                      <span>{formatKobo(l.amount_kobo)}</span>
                    </li>
                  ))}
                </ul>
                {p.reference && <p className="mt-2 text-xs text-charcoal-ink/60">Transfer reference {p.reference}</p>}
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
