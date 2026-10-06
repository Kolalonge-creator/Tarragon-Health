import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import { STATE_LABEL, adminPayoutRowsSchema, stateVariant } from "@/lib/payouts/payouts";
import { BuildDraftsForm, PayoutRowActions } from "./payout-forms";

/**
 * The admin payout run: weekly drafts, approval, sending, retry. Every state change is made by a database function that checks the
 * role, the go-live guard and the ledger again; this page only shows what is there and what can be pressed.
 */
export async function AdminPayoutsView() {
  const supabase = await createClient();
  const [list, guard] = await Promise.all([supabase.rpc("list_payouts"), supabase.rpc("go_live_guard_is_open", { p_key: "payouts_enabled" })]);
  const rows = list.error ? null : adminPayoutRowsSchema.safeParse(list.data);
  const open = guard.error ? false : guard.data === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Payouts</h1>
        <p className="text-sm text-charcoal-ink/60">
          Each Monday morning the system adds up every unpaid earning of each contracted clinician and makes a draft. Nothing is paid until you approve a draft and press Send. Earnings below the minimum carry over to the next week.
        </p>
      </div>

      {!open && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Payouts are switched off. Drafts can be made and read, but approving and sending are refused until the founder switches payouts on from the go-live page.
        </p>
      )}

      <Card><CardHeader><CardTitle>Drafts</CardTitle></CardHeader><CardContent><BuildDraftsForm /></CardContent></Card>

      <Card>
        <CardHeader><CardTitle>Payouts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!rows?.success ? (
            <p role="alert" className="text-sm text-red-600">The payouts could not be loaded. This is not the same as there being none.</p>
          ) : rows.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No payouts yet.</p>
          ) : (
            rows.data.map((r) => (
              <div key={r.id} className="space-y-1 border-b border-charcoal-ink/10 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.clinician_name ?? "A clinician"}</span>
                  <span className="font-semibold">{formatKobo(r.amount_kobo)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-charcoal-ink/60">
                  <Badge variant={stateVariant(r.state)}>{STATE_LABEL[r.state] ?? r.state}</Badge>
                  <span>Up to {r.period_end}, {r.line_count} earning{r.line_count === 1 ? "" : "s"}</span>
                  {r.state === "draft" && !r.bank_ready && <span className="text-red-600">No verified bank account yet</span>}
                  {r.failure_reason && <span className="text-red-600">{r.failure_reason}</span>}
                  {r.reference && <span>Ref {r.reference}</span>}
                </div>
                <PayoutRowActions row={r} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
