import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/partner-portal/action-form";
import { disputeStatementAction } from "@/lib/partner-network/actions";
import { formatKobo } from "@/lib/format-money";
import { STATEMENT_STATE_LABEL, monthLabel, statementLinesSchema, statementsSchema } from "@/lib/partner-network/model";

export const metadata = { title: "Statements" };
export const dynamic = "force-dynamic";

export default async function PharmacistStatementsPage() {
  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("partner_my_statements");
  const rows = error ? null : statementsSchema.safeParse(data);
  const lines = rows?.success
    ? await Promise.all(rows.data.map(async (r) => {
        const l = await supabase.rpc("partner_my_statement_lines", { p_settlement: r.settlement_id });
        return [r.settlement_id, l.error ? null : statementLinesSchema.safeParse(l.data)] as const;
      }))
    : [];
  const byId = new Map(lines);
  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/70">
        A statement shows what Tarragon owes your pharmacy for a month, only from money Tarragon itself collected. Medicines you sell directly to patients are not on it. Tarragon records the payment here after it is made; nothing is taken from you.
      </p>
      {!rows?.success && <p role="alert" className="text-sm text-red-600">Your statements could not be loaded. This is not the same as there being none.</p>}
      {rows?.success && rows.data.length === 0 && <p className="text-sm text-charcoal-ink/60">No statement has been issued to you yet.</p>}
      {rows?.success && rows.data.map((r) => {
        const l = byId.get(r.settlement_id);
        return (
          <Card key={r.settlement_id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">{monthLabel(r.period_month)}</CardTitle>
              <Badge variant={r.state === "settled" ? "green" : r.state === "disputed" ? "amber" : "blue"}>{STATEMENT_STATE_LABEL[r.state]}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p><span className="text-xl font-semibold">{formatKobo(r.amount_kobo)}</span> across {r.item_count} {r.item_count === 1 ? "item" : "items"}{r.state === "settled" && r.external_reference ? `, payment reference ${r.external_reference}` : ""}</p>
              {l?.success ? (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-charcoal-ink/60"><th className="py-1">Line</th><th>Paid on</th><th>Item</th><th className="text-right">Order</th><th className="text-right">Your share</th></tr></thead>
                  <tbody>{l.data.map((x) => (
                    <tr key={x.line_ref} className="border-t border-charcoal-ink/10"><td className="py-1">{x.line_ref}</td><td>{x.paid_on}</td><td>{x.catalog_code}</td><td className="text-right">{formatKobo(x.basis_amount_kobo)}</td><td className="text-right">{formatKobo(x.amount_kobo)}</td></tr>
                  ))}</tbody>
                </table>
              ) : <p role="alert" className="text-red-600">The lines could not be loaded.</p>}
              {r.state === "issued" && (
                <details>
                  <summary className="cursor-pointer text-brand-green">Something does not look right</summary>
                  <div className="mt-2"><ActionForm action={disputeStatementAction} hidden={{ id: r.settlement_id }} fields={[{ name: "note", label: "What looks wrong", kind: "textarea", placeholder: "For example: two lines on the 12th look the same" }]} submitLabel="Send to Tarragon" variant="outline" successText="Sent. Tarragon will look at it." /></div>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
