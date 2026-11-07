"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadFailure } from "@/components/ui/load-failure";
import { formatMinor } from "@/lib/analytics/format";
import { PAYER_TYPE_LABEL, providerLabel, streamLabel } from "@/lib/finance/definitions";
import {
  EVENT_KIND_LABEL,
  SETTLEMENT_LABEL,
  useTransactionDetail,
  type RecordType,
  type TransactionDetail,
} from "@/lib/finance/transactions";
import { CenterNote, SectionCard, TableShell, Th } from "./primitives";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not recorded";
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }) : "Not recorded";
const words = (code: string) => code.replace(/_/g, " ");

const KIND_TONE = { payment: "normal", failed_payment: "attention", refund: "info" } as const;
const SETTLEMENT_TONE = { settled: "normal", awaiting_settlement: "grey", exception: "attention", not_applicable: "inactive" } as const;
const TIMELINE_DOT: Record<string, string> = {
  event: "bg-brand-green",
  webhook: "bg-clinical-navy",
  refund: "bg-sprout-gold",
  settlement: "bg-brand-green",
  reconciliation: "bg-status-attention",
  ledger: "bg-charcoal-ink/40",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{label}</dt>
      <dd className="mt-0.5 text-sm text-charcoal-ink dark:text-night-ink">{children}</dd>
    </div>
  );
}

function Summary({ d }: { d: TransactionDetail }) {
  const e = d.event;
  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={KIND_TONE[e.event_kind]}>{EVENT_KIND_LABEL[e.event_kind]}</Badge>
            <Badge variant={SETTLEMENT_TONE[e.settlement_status]}>{SETTLEMENT_LABEL[e.settlement_status]}</Badge>
            {e.is_renewal && <Badge variant="info">Renewal</Badge>}
          </div>
          <p className="mt-2 font-heading text-3xl font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">
            {e.event_kind === "refund" ? "−" : ""}
            {formatMinor(e.amount_minor, e.currency)}
          </p>
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            {streamLabel(e.stream)} · {when(e.occurred_at)}
          </p>
        </div>
        {d.refundable_minor !== null && (
          <div className="text-right">
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Still refundable</p>
            <p className="font-heading text-lg font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">
              {formatMinor(d.refundable_minor, e.currency)}
            </p>
          </div>
        )}
      </div>
      {e.processing_error && (
        <p className="mt-3 rounded-md bg-status-attention-tint px-3 py-2 text-xs text-status-attention-text">
          Paystack took this payment but our system did not apply it. Check that the payer received what they paid for.
        </p>
      )}
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Payer">
          {d.payer.label}
          <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{PAYER_TYPE_LABEL[d.payer.kind] ?? d.payer.kind}</span>
        </Field>
        <Field label="Beneficiary">{d.beneficiary?.label ?? "Same as payer"}</Field>
        <Field label="Provider">{providerLabel(e.provider)}</Field>
        <Field label="Reference">
          <span className="break-all font-mono text-xs">{e.reference ?? "None"}</span>
        </Field>
        {e.fee_minor !== null && <Field label="Card fee paid by payer">{formatMinor(e.fee_minor, e.currency)}</Field>}
        <Field label="Record">
          {words(e.record_type)}
          <span className="block break-all font-mono text-xs text-charcoal-ink/60 dark:text-night-ink/60">{e.record_id}</span>
        </Field>
      </dl>
      {d.beneficiary && (
        <p className="mt-4 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Paying for someone else gives the payer no access to that person&apos;s health record.
        </p>
      )}
    </div>
  );
}

function Timeline({ d }: { d: TransactionDetail }) {
  return (
    <SectionCard title="Timeline" description="Everything recorded about this transaction, in order (Lagos time).">
      {d.timeline.length === 0 ? (
        <CenterNote>Nothing else is recorded yet.</CenterNote>
      ) : (
        <ol className="relative space-y-3 border-l border-charcoal-ink/10 pl-5 dark:border-night-ink/15">
          {d.timeline.map((t, i) => (
            <li key={`${t.at}-${i}`} className="relative">
              <span aria-hidden className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${TIMELINE_DOT[t.kind] ?? "bg-charcoal-ink/40"}`} />
              <p className="text-sm text-charcoal-ink dark:text-night-ink">{t.label}</p>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{when(t.at)}</p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

function Commercial({ d }: { d: TransactionDetail }) {
  const o = d.order;
  if (!o && !d.membership?.length) return null;
  return (
    <SectionCard title="What was bought" description="The checkout order and the Membership it gave, if any. No health information is shown.">
      {o && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Item">{o.item ? words(o.item) : "Not recorded"}</Field>
          <Field label="Order state">{words(o.state)}</Field>
          {o.list_amount_minor !== null && <Field label="List price">{formatMinor(o.list_amount_minor, "NGN")}</Field>}
          <Field label="Price charged">{formatMinor(o.amount_minor, "NGN")}</Field>
          {(o.discount_minor ?? 0) > 0 && <Field label="Discount">{formatMinor(o.discount_minor ?? 0, "NGN")}</Field>}
          {(o.sponsor_share_minor ?? 0) > 0 && <Field label="Paid by a sponsor programme">{formatMinor(o.sponsor_share_minor ?? 0, "NGN")}</Field>}
          {o.total_minor !== null && <Field label="Total charged">{formatMinor(o.total_minor, "NGN")}</Field>}
          {o.failure_reason && <Field label="Why it failed">{o.failure_reason}</Field>}
        </dl>
      )}
      {d.membership && d.membership.length > 0 && (
        <div className="mt-5">
          <TableShell>
            <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <tr>
                <Th>Membership</Th>
                <Th>State</Th>
                <Th>Starts</Th>
                <Th>Ends</Th>
                <Th>Renews automatically</Th>
              </tr>
            </thead>
            <tbody>
              {d.membership.map((m) => (
                <tr key={m.id} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                  <td className="py-2 pr-4">{m.tier === "plus" ? "Membership Plus (retired)" : "Membership"}</td>
                  <td className="py-2 pr-4">{words(m.state)}</td>
                  <td className="py-2 pr-4">{day(m.starts_at)}</td>
                  <td className="py-2 pr-4">{m.ends_at ? day(m.ends_at) : "No end date"}</td>
                  <td className="py-2 pr-4">{m.auto_renew && !m.renewal_cancelled_at ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </SectionCard>
  );
}

function OtherRefunds({ d }: { d: TransactionDetail }) {
  if (d.other_refunds.length === 0) return null;
  return (
    <SectionCard title="Refunds of this charge" description="Confirmed refunds recorded against this Paystack charge.">
      <ul className="space-y-2 text-sm">
        {d.other_refunds.map((r) => (
          <li key={r.event_id} className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/finance/transactions/${r.record_type}/${r.record_id}`} className="text-brand-green hover:underline dark:text-brand-green-bright">
              {streamLabel(r.stream)} refund, {when(r.occurred_at)}
            </Link>
            <span className="tabular-nums">{formatMinor(r.amount_minor, "NGN")}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function Refunds({ d }: { d: TransactionDetail }) {
  if (d.event.record_type !== "order" && d.refunds.length === 0) return null;
  return (
    <SectionCard title="Refunds" description="Refunds against this payment. Only a refund Paystack has confirmed counts as completed.">
      {d.refunds.length === 0 ? (
        <CenterNote>No refunds against this payment.</CenterNote>
      ) : (
        <TableShell>
          <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            <tr>
              <Th>Requested</Th>
              <Th right>Amount</Th>
              <Th>State</Th>
              <Th>Decided</Th>
              <Th>Completed</Th>
              <Th>Reason</Th>
            </tr>
          </thead>
          <tbody>
            {d.refunds.map((r) => (
              <tr key={r.id} className="border-t border-charcoal-ink/5 align-top dark:border-night-ink/10">
                <td className="py-2 pr-4">{when(r.requested_at)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(r.amount_minor, "NGN")}</td>
                <td className="py-2 pr-4">
                  {words(r.state)}
                  {r.last_error_code && <span className="block text-xs text-status-attention-text">Last error: {r.last_error_code}</span>}
                </td>
                <td className="py-2 pr-4">{r.decided_at ? `${when(r.decided_at)}${r.decided_by ? ` by ${r.decided_by}` : ""}` : "Waiting"}</td>
                <td className="py-2 pr-4">{r.completed_at ? when(r.completed_at) : "Not yet"}</td>
                <td className="py-2 pr-4 text-charcoal-ink/80 dark:text-night-ink/80">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </SectionCard>
  );
}

function Provider({ d }: { d: TransactionDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Paystack events" description="Webhook deliveries for this reference. Message bodies are never shown here.">
        {d.webhooks.length === 0 ? (
          <CenterNote>No Paystack events are recorded for this reference.</CenterNote>
        ) : (
          <ul className="space-y-2 text-sm">
            {d.webhooks.map((w, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs">{w.event_type}</span>
                <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {words(w.status)} · {when(w.received_at)}
                  {w.attempt_count ? ` · ${w.attempt_count} attempt${w.attempt_count === 1 ? "" : "s"}` : ""}
                  {w.signature_verified === false ? " · signature not verified" : ""}
                </span>
                {w.last_error && <span className="w-full text-xs text-status-attention-text">{w.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Settlement and reconciliation" description="Whether Paystack has paid this money out to Tarragon, and any mismatch found.">
        {d.settlement.length === 0 && d.reconciliation.length === 0 ? (
          <CenterNote>
            {d.event.settlement_status === "not_applicable" ? "Settlement does not apply to this record." : "No settlement or reconciliation record yet."}
          </CenterNote>
        ) : (
          <ul className="space-y-3 text-sm">
            {d.settlement.map((s, i) => (
              <li key={`s${i}`}>
                <p className="text-charcoal-ink dark:text-night-ink">
                  Settled {s.amount_kobo !== null ? formatMinor(s.amount_kobo, "NGN") : ""}
                  {s.fees_kobo !== null ? ` less ${formatMinor(s.fees_kobo, "NGN")} Paystack fees` : ""}
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {s.provider_settlement_id ? `Settlement ${s.provider_settlement_id} · ` : ""}
                  {words(s.report_status ?? "status unknown")} · {when(s.settled_at)}
                </p>
              </li>
            ))}
            {d.reconciliation.map((x, i) => (
              <li key={`r${i}`}>
                <p className="text-charcoal-ink dark:text-night-ink">
                  <Badge variant={x.status === "open" ? "attention" : "grey"} className="mr-2">
                    {x.status}
                  </Badge>
                  {words(x.type)}
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {x.provider_minor !== null ? `Paystack ${formatMinor(x.provider_minor, "NGN")}` : ""}
                  {x.local_minor !== null ? ` · Our record ${formatMinor(x.local_minor, "NGN")}` : ""}
                  {x.difference_minor !== null ? ` · Difference ${formatMinor(x.difference_minor, "NGN")}` : ""}
                  {` · first seen ${when(x.seen_at)}`}
                </p>
                {x.note && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{x.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function Ledger({ d }: { d: TransactionDetail }) {
  return (
    <SectionCard title="Ledger postings" description="Journal entries the general ledger holds for this record.">
      {d.ledger.length === 0 ? (
        <CenterNote>Nothing is posted to the ledger for this record.</CenterNote>
      ) : (
        <div className="space-y-4">
          {d.ledger.map((j) => (
            <div key={j.id}>
              <p className="text-sm text-charcoal-ink dark:text-night-ink">
                {day(j.entry_date)} · {words(j.source)}
                {j.memo ? <span className="text-charcoal-ink/60 dark:text-night-ink/60"> · {j.memo}</span> : null}
              </p>
              <TableShell>
                <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <tr>
                    <Th>Account</Th>
                    <Th right>Debit</Th>
                    <Th right>Credit</Th>
                  </tr>
                </thead>
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                      <td className="py-1.5 pr-4">
                        {l.account_code} {l.account_name}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{l.debit_minor ? formatMinor(l.debit_minor, "NGN") : ""}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{l.credit_minor ? formatMinor(l.credit_minor, "NGN") : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function TransactionDetailView({ recordType, recordId }: { recordType: RecordType; recordId: string }) {
  const q = useTransactionDetail(recordType, recordId);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/transactions" className="inline-flex items-center gap-1 text-sm text-brand-green hover:underline dark:text-brand-green-bright">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Transactions
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Transaction</h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Opening this record is logged in the finance audit log.</p>
      </div>
      {q.isLoading && <CenterNote>Loading the transaction…</CenterNote>}
      {q.isError && (
        <LoadFailure>
          This transaction could not be loaded. If your finance access has changed, a reload will say so. Nothing below is a
          reason to think the record is missing.
        </LoadFailure>
      )}
      {q.data === null && <CenterNote>No transaction with this reference exists, or it belongs to a test account.</CenterNote>}
      {q.data && (
        <>
          <Summary d={q.data} />
          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="space-y-6">
              <Commercial d={q.data} />
              <Refunds d={q.data} />
              <OtherRefunds d={q.data} />
              <Provider d={q.data} />
              <Ledger d={q.data} />
            </div>
            <Timeline d={q.data} />
          </div>
        </>
      )}
    </div>
  );
}
