import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/partner-portal/action-form";
import { approveTermsAction, createTermsAction, issueSettlementAction, recordPaidAction, runSettlementAction, voidSettlementAction } from "@/lib/partner-network/actions";
import { formatKobo } from "@/lib/format-money";
import { adminSettlementsSchema, findingsSchema, monthLabel, previewSchema } from "@/lib/partner-network/model";

export const metadata = { title: "Partner settlements" };
export const dynamic = "force-dynamic";

const termsSchema = z.array(z.object({ id: z.string().uuid(), partner_kind: z.string(), partner_id: z.string().uuid(), source_kind: z.string(), basis: z.string(), value: z.number(), sponsor_paid_only: z.boolean(), approved_at: z.string().nullable(), valid_to: z.string().nullable(), created_by: z.string().uuid() }));
const catalogueSchema = z.object({ items: z.array(z.object({ code: z.string() })) });

/**
 * Partner settlement (S74, 21.6, decision S74-2). A monthly statement of what Tarragon owes a pharmacy or clinic, only from money Tarragon collected.
 * Laboratories are never on it (D-06). Nothing on this page moves money: a person pays outside the platform and records the bank reference.
 * The whole feature is behind a go-live guard that ships off.
 */
export default async function AdminPartnerSettlementsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = loose(await createClient());
  const [guard, st, terms, prev, find, cat, ov] = await Promise.all([
    supabase.rpc("go_live_guard_is_open", { p_key: "partner_settlement_enabled" }),
    supabase.rpc("admin_list_settlements"),
    supabase.from("partner_settlement_terms").select("id, partner_kind, partner_id, source_kind, basis, value, sponsor_paid_only, approved_at, valid_to, created_by").order("created_at", { ascending: false }),
    supabase.rpc("partner_settlement_preview"),
    supabase.rpc("partner_double_payment_check"),
    supabase.rpc("admin_catalogue"),
    supabase.rpc("partner_quality_overview"),
  ]);
  const open = guard.error ? false : guard.data === true;
  const settlements = st.error ? null : adminSettlementsSchema.safeParse(st.data);
  const termRows = terms.error ? null : termsSchema.safeParse(terms.data);
  const preview = prev.error ? null : previewSchema.safeParse(prev.data);
  const findings = find.error ? null : findingsSchema.safeParse(find.data);
  const items = cat.error ? [] : (catalogueSchema.safeParse(cat.data).data?.items ?? []);
  const partners = ov.error ? [] : (ov.data as Array<{ partner_kind: string; partner_id: string; partner_name: string | null }>).filter((p) => p.partner_kind !== "lab");

  return (
    <div className="space-y-6">
      <PageHeader title="Partner settlements" description="What Tarragon owes a pharmacy or clinic for a month, from money Tarragon itself collected. Laboratories are paid by the patient directly and are never on a statement." />
      {!open && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Partner settlement is switched off. You can write and approve terms and see what a month would produce. Building, issuing and recording are refused until it is switched on from the go-live page.</p>}
      {findings?.success && findings.data.length > 0 && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{findings.data.length} order(s) would be paid through two systems or were refunded after a statement was issued. Look at these before issuing anything.</p>
      )}

      <Card>
        <CardHeader><CardTitle>Statements</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ActionForm action={runSettlementAction} compact fields={[{ name: "month", label: "Month (blank for last month)", kind: "month", required: false }]} submitLabel="Build drafts" variant="outline" successText="Drafts built." />
          {!settlements?.success && <p role="alert" className="text-red-600">Statements could not be loaded. This is not the same as there being none.</p>}
          {settlements?.success && settlements.data.length === 0 && <p className="text-charcoal-ink/60">No statements yet. With no approved terms and no qualifying paid orders the first run builds none, and that is correct.</p>}
          {settlements?.success && settlements.data.map((s) => (
            <div key={s.settlement_id} className="space-y-2 border-b border-charcoal-ink/10 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{s.partner_name ?? "A partner"} <span className="text-charcoal-ink/60">{monthLabel(s.period_month)}</span></span>
                <span className="flex items-center gap-2"><span className="font-semibold">{formatKobo(s.amount_kobo)}</span><Badge variant={s.state === "settled" ? "green" : s.state === "disputed" ? "amber" : s.state === "void" ? "grey" : "blue"}>{s.state}</Badge></span>
              </div>
              {s.dispute_note && <p className="text-xs text-amber-900">Partner question: {s.dispute_note}</p>}
              <div className="flex flex-wrap items-start gap-3">
                {(s.state === "draft" || s.state === "disputed") && <ActionForm action={issueSettlementAction} hidden={{ id: s.settlement_id }} fields={[]} submitLabel={s.state === "draft" ? "Issue to partner" : "Issue again"} variant="outline" successText="Issued." />}
                {s.state === "issued" && <ActionForm action={recordPaidAction} hidden={{ id: s.settlement_id }} compact fields={[{ name: "reference", label: "Bank reference of the payment made outside the platform" }]} submitLabel="Record as paid" variant="outline" successText="Recorded." />}
                {["draft", "issued", "disputed"].includes(s.state) && <ActionForm action={voidSettlementAction} hidden={{ id: s.settlement_id }} compact fields={[{ name: "reason", label: "Why withdraw it" }]} submitLabel="Withdraw" variant="outline" />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>What last month would produce</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {!preview?.success ? <p role="alert" className="text-red-600">The preview could not be loaded.</p> : preview.data.length === 0 ? <p className="text-charcoal-ink/60">No approved terms, so nothing to settle.</p> : (
            <ul className="space-y-1">{preview.data.map((p) => <li key={p.term_id}>{p.partner_name ?? "A partner"}: {p.orders} {p.orders === 1 ? "order" : "orders"}, {formatKobo(p.amount_kobo)}</li>)}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-charcoal-ink/70">Terms count only after a second person approves them. They cannot be edited: end them and write new ones.</p>
          {!termRows?.success && <p role="alert" className="text-red-600">Terms could not be loaded.</p>}
          {termRows?.success && termRows.data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/10 pb-2">
              <span>{partners.find((p) => p.partner_id === t.partner_id)?.partner_name ?? "A partner"}: {t.basis === "fixed_kobo" ? formatKobo(t.value) : `${t.value / 100}%`} ({t.source_kind === "sponsor_paid_item" ? "sponsor paid item" : "pharmacy margin"}){t.valid_to ? ", ended" : ""}</span>
              {t.approved_at ? <Badge variant="green">Approved</Badge> : <ActionForm action={approveTermsAction} hidden={{ id: t.id }} fields={[]} submitLabel="Approve" variant="outline" successText="Approved." />}
            </div>
          ))}
          <details><summary className="cursor-pointer text-brand-green">Write new terms</summary>
            <div className="mt-2 max-w-md">
              <ActionForm action={createTermsAction} fields={[
                { name: "kind", label: "Kind of partner", kind: "select", options: [{ value: "pharmacy", label: "Pharmacy" }, { value: "clinic", label: "Clinic" }] },
                { name: "partner", label: "Partner", kind: "select", options: partners.map((p) => ({ value: p.partner_id, label: `${p.partner_name ?? "Unnamed"} (${p.partner_kind})` })) },
                { name: "catalog_code", label: "Catalogue item", kind: "select", options: items.map((i) => ({ value: i.code, label: i.code })) },
                { name: "source", label: "Why Tarragon owes it", kind: "select", options: [{ value: "sponsor_paid_item", label: "A sponsor paid for the item" }, { value: "pharmacy_margin", label: "Pharmacy margin" }] },
                { name: "basis", label: "How the share is worked out", kind: "select", options: [{ value: "fixed_kobo", label: "A fixed amount in naira" }, { value: "basis_points", label: "A percentage of the order" }] },
                { name: "value", label: "Amount in naira, or percentage", hint: "A percentage rounds down to the kobo." },
                { name: "sponsor_paid_only", label: "Only when someone other than the patient paid", kind: "checkbox", defaultValue: "on" },
                { name: "reason", label: "What was agreed, and with whom (at least 20 characters)", kind: "textarea" },
              ]} submitLabel="Save terms" successText="Saved. A second person must approve them." />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
