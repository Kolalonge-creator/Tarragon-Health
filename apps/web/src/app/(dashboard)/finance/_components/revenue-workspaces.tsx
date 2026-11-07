"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import {
  MEMBERSHIP_PAGE_SIZE,
  MEMBERSHIP_PAYER_LABEL,
  MEMBERSHIP_PAYER_TYPES,
  MEMBERSHIP_STATES,
  MEMBERSHIP_STATE_LABEL,
  employerTotals,
  renewalRateText,
  useEmployerRevenue,
  useMembershipRevenue,
  useMembershipsList,
  useSponsorships,
  type MembershipFilters,
} from "@/lib/finance/revenue-workspaces";
import { transactionHref } from "@/lib/finance/transactions";
import { PeriodSelector, useFinancePeriod } from "./period-selector";
import { CenterNote, SectionCard, TableShell, Th } from "./primitives";

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }) : "Not set";
const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "Not recorded");

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
      <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{note}</p>}
    </div>
  );
}

function Chips({ legend, options, labels, selected, onChange }: {
  legend: string; options: readonly string[]; labels: Record<string, string>; selected: string[]; onChange: (n: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="mr-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{legend}</legend>
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])}
            className={`rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
              on ? "border-brand-green bg-soft-sage text-charcoal-ink dark:bg-brand-green/20 dark:text-night-ink"
                 : "border-charcoal-ink/15 text-charcoal-ink/70 dark:border-night-ink/20 dark:text-night-ink/70"}`}>
            {labels[o] ?? o}
          </button>
        );
      })}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Membership revenue
// ---------------------------------------------------------------------------

export function MembershipWorkspace() {
  const period = useFinancePeriod();
  const rev = useMembershipRevenue(period.from, period.to);
  const [filters, setFilters] = useState<MembershipFilters>({ states: ["active"], payerTypes: [], search: "", expiringWithinDays: null, page: 0 });
  const list = useMembershipsList(filters);
  const r = rev.data;
  const set = (next: Partial<MembershipFilters>) => setFilters((f) => ({ ...f, ...next, page: next.page ?? 0 }));
  // Each list read is audited, so search waits for a pause in typing.
  const [searchText, setSearchText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText, page: 0 })), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
        <PeriodSelector period={period} />
      </div>
      {rev.isError && !r && <LoadFailure>The Membership figures could not be loaded, so none are shown rather than zeros. Reload to try again.</LoadFailure>}
      {rev.isError && r && <StaleDataNotice>The figures below may be out of date: the last refresh failed.</StaleDataNotice>}
      {rev.isLoading && <CenterNote>Loading Membership figures…</CenterNote>}
      {r && (
        <>
          <section aria-label="Memberships in force" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure label="Paid Memberships in force" value={formatNumber(r.in_force.paid)} note={`On ${day(r.as_of)}. ${formatNumber(r.in_force.auto_renew)} renew automatically.`} />
            <Figure label="Paid by the member" value={formatNumber(r.in_force.individual)} />
            <Figure label="Paid by a family sponsor" value={formatNumber(r.in_force.family_sponsor)} />
            <Figure label="Paid by an employer" value={formatNumber(r.in_force.employer)} note={r.in_force.granted ? `${formatNumber(r.in_force.granted)} granted free are not counted.` : undefined} />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Membership revenue" description={`Payments for Memberships confirmed ${period.label}, on the same basis as the overview.`}>
              <dl className="grid grid-cols-2 gap-4">
                {[
                  ["Gross", formatMinor(r.revenue.gross_minor, "NGN")],
                  ["Refunds", formatMinor(r.revenue.refunds_minor, "NGN")],
                  ["Net collections", formatMinor(r.revenue.net_minor, "NGN")],
                  ["From renewals", formatMinor(r.revenue.renewal_gross_minor, "NGN")],
                  ["Paid by members", formatMinor(r.revenue.individual_minor, "NGN")],
                  ["Paid by sponsors", formatMinor(r.revenue.family_sponsor_minor, "NGN")],
                  ["Paid by employers", formatMinor(r.revenue.employer_minor, "NGN")],
                  ["Payments", formatNumber(r.revenue.payments)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{k}</dt>
                    <dd className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
            <SectionCard title="Renewals and movement" description="Who joined, renewed, left or is about to come up for renewal.">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["New paid Memberships", formatNumber(r.new_paid)],
                  ["Renewals paid", formatNumber(r.renewals)],
                  ["Ended early (refunded or cancelled)", formatNumber(r.ended_early)],
                  ["Lapsed (not renewed)", formatNumber(r.lapsed)],
                  ["Failed automatic renewal charges", formatNumber(r.failed_renewal_charges)],
                  ["Due to end in the next 30 days", `${formatNumber(r.expiring_30d)} (${formatNumber(r.expiring_30d_auto_renew)} renew automatically)`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{k}</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-charcoal-ink dark:text-night-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 rounded-md bg-soft-sage/60 px-3 py-2 text-sm text-charcoal-ink dark:bg-brand-green/10 dark:text-night-ink">
                <span className="font-medium">Renewal rate:</span> {renewalRateText(r)}.
                <span className="mt-1 block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Counted over paid Memberships whose year ended in this period. A Membership counts as renewed when a renewal for it was paid.
                </span>
              </p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => set({ states: ["active"], expiringWithinDays: 30 })}>
                List the ones due in 30 days
              </Button>
            </SectionCard>
          </div>
        </>
      )}

      <SectionCard title="Memberships" description="Each Membership with who it is for and who paid. Names only, no health information. Reading this list is logged.">
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <Chips legend="State" options={MEMBERSHIP_STATES} labels={MEMBERSHIP_STATE_LABEL} selected={filters.states} onChange={(states) => set({ states })} />
          <Chips legend="Paid by" options={MEMBERSHIP_PAYER_TYPES} labels={MEMBERSHIP_PAYER_LABEL} selected={filters.payerTypes} onChange={(payerTypes) => set({ payerTypes })} />
          <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
            Search
            <Input type="search" className="h-9 w-56" value={searchText} placeholder="Name or reference" onChange={(e) => setSearchText(e.target.value.slice(0, 100))} />
          </label>
          {filters.expiringWithinDays !== null && (
            <Button size="sm" variant="ghost" onClick={() => set({ expiringWithinDays: null })}>
              Showing ending within {filters.expiringWithinDays} days. Show all
            </Button>
          )}
        </div>
        {list.isError && !list.data && <LoadFailure>The Memberships could not be loaded. That is not the same as there being none.</LoadFailure>}
        {list.isLoading && <CenterNote>Loading…</CenterNote>}
        {list.data && (list.data.rows.length === 0 ? (
          <CenterNote>No Memberships match these filters.</CenterNote>
        ) : (
          <>
            <TableShell>
              <caption className="sr-only">Memberships</caption>
              <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                <tr>
                  <Th>Member</Th>
                  <Th>Paid by</Th>
                  <Th>State</Th>
                  <Th>Starts</Th>
                  <Th>Ends</Th>
                  <Th>Renewal</Th>
                  <Th right>Paid</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((m) => {
                  const href = m.order_id ? transactionHref("order", m.order_id) : null;
                  return (
                    <tr key={m.id} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                      <td className="py-2 pr-4 text-charcoal-ink dark:text-night-ink">
                        {m.beneficiary}
                        {m.tier === "plus" && <span className="ml-1 text-xs text-charcoal-ink/60">(Plus, retired)</span>}
                      </td>
                      <td className="py-2 pr-4">
                        {MEMBERSHIP_PAYER_LABEL[m.payer_type] ?? m.payer_type}
                        {(m.sponsor || m.employer) && <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{m.sponsor ?? m.employer}</span>}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={m.state === "active" ? "normal" : m.state === "lapsed" ? "attention" : "grey"}>{MEMBERSHIP_STATE_LABEL[m.state] ?? m.state}</Badge>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">{day(m.starts_at)}</td>
                      <td className="whitespace-nowrap py-2 pr-4">{m.ended_at ? `${day(m.ended_at)} (ended)` : day(m.ends_at)}</td>
                      <td className="py-2 pr-4 text-xs">
                        {m.renewed ? "Renewed" : m.auto_renew ? "Renews automatically" : m.payer_type === "granted" ? "Not applicable" : "Renews by hand"}
                        {m.is_renewal && <span className="block text-charcoal-ink/60">This is a renewal</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                        {m.amount_paid_minor !== null ? (
                          href ? <Link className="text-brand-green hover:underline dark:text-brand-green-bright" href={href}>{formatMinor(m.amount_paid_minor, "NGN")}</Link> : formatMinor(m.amount_paid_minor, "NGN")
                        ) : m.payer_type === "employer" ? "Invoiced" : "Not paid"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
            <Pager total={list.data.total} page={filters.page} onPage={(page) => set({ page })} />
          </>
        ))}
      </SectionCard>
    </div>
  );
}

function Pager({ total, page, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / MEMBERSHIP_PAGE_SIZE));
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-xs text-charcoal-ink/60 dark:text-night-ink/60">
      <span>{formatNumber(total)} in all · page {page + 1} of {formatNumber(pages)}</span>
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Family sponsorships
// ---------------------------------------------------------------------------

export function SponsorshipsWorkspace() {
  const period = useFinancePeriod();
  const [page, setPage] = useState(0);
  const q = useSponsorships(period.from, period.to, page);
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
        <PeriodSelector period={period} />
      </div>
      {q.isError && !d && <LoadFailure>The sponsorships could not be loaded. That is not the same as there being none.</LoadFailure>}
      {q.isLoading && <CenterNote>Loading sponsorships…</CenterNote>}
      {d && (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Sponsorship totals">
            <Figure label="Paid by sponsors" value={formatMinor(d.total_minor, "NGN")} note={`${formatNumber(d.total)} payments, ${period.label}`} />
            <Figure label="Sponsors" value={formatNumber(d.sponsors)} />
            <Figure label="People sponsored" value={formatNumber(d.beneficiaries)} />
          </section>
          <SectionCard title="Sponsored payments" description="Checkout orders and Care Vouchers paid for someone else, including by relatives abroad. Paying gives a sponsor no access to the member's health record. Reading this list is logged.">
            {d.rows.length === 0 ? (
              <CenterNote>No sponsored payments in this period.</CenterNote>
            ) : (
              <>
                <TableShell>
                  <caption className="sr-only">Sponsored payments</caption>
                  <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    <tr><Th>Date</Th><Th>Sponsor</Th><Th>For</Th><Th>What</Th><Th>Membership period</Th><Th>Status</Th><Th right>Amount</Th></tr>
                  </thead>
                  <tbody>
                    {d.rows.map((s) => {
                      const href = s.kind === "order" ? transactionHref("order", s.record_id) : null;
                      return (
                        <tr key={`${s.kind}:${s.record_id}`} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                          <td className="whitespace-nowrap py-2 pr-4">{day(s.paid_at)}</td>
                          <td className="py-2 pr-4">{s.sponsor}</td>
                          <td className="py-2 pr-4">{s.beneficiary}</td>
                          <td className="py-2 pr-4">{s.kind === "care_voucher" ? "Care Voucher" : words(s.item)}</td>
                          <td className="py-2 pr-4 text-xs">
                            {s.membership ? `${day(s.membership.starts_at)} to ${day(s.membership.ends_at)}${s.membership.auto_renew ? ", renews automatically" : ""}` : "Not a Membership"}
                          </td>
                          <td className="py-2 pr-4">{words(s.status)}</td>
                          <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                            {s.amount_minor === null ? "Not recorded" : href ? <Link className="text-brand-green hover:underline dark:text-brand-green-bright" href={href}>{formatMinor(s.amount_minor, "NGN")}</Link> : formatMinor(s.amount_minor, "NGN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableShell>
                <Pager total={d.total} page={page} onPage={setPage} />
              </>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employer revenue
// ---------------------------------------------------------------------------

export function EmployerRevenueWorkspace() {
  const q = useEmployerRevenue();
  const rows = q.data ?? [];
  const t = employerTotals(rows);
  return (
    <div className="space-y-6">
      {q.isError && <LoadFailure>The employer accounts could not be loaded. That is not the same as there being none.</LoadFailure>}
      {q.isLoading && <CenterNote>Loading employer accounts…</CenterNote>}
      {q.data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Employer totals">
            <Figure label="Invoiced" value={formatMinor(t.invoiced, "NGN")} />
            <Figure label="Paid" value={formatMinor(t.paid, "NGN")} />
            <Figure label="Outstanding" value={formatMinor(t.outstanding, "NGN")} note={t.overdue ? `${formatMinor(t.overdue, "NGN")} past its due date` : "Nothing past its due date"} />
            <Figure label="Employees with Membership" value={formatNumber(t.members)} />
          </section>
          <SectionCard
            title="Employer accounts"
            description="Commercial terms and billing for each employer. On-site screening is billed separately from Membership seats. No employee is named here and no health information is shown."
            actions={<Link href="/finance/employer-billing" className="text-xs font-medium text-brand-green hover:underline dark:text-brand-green-bright">Billing setup →</Link>}
          >
            {rows.length === 0 ? (
              <CenterNote>No employer has a contract, invoice or seat purchase yet.</CenterNote>
            ) : (
              <TableShell>
                <caption className="sr-only">Employer accounts</caption>
                <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <tr><Th>Employer</Th><Th>Contract</Th><Th right>Seats</Th><Th right>Price per seat</Th><Th right>Invoiced</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th>Renews</Th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.organisation_id} className="border-t border-charcoal-ink/5 align-top dark:border-night-ink/10">
                      <td className="py-2 pr-4">
                        {r.name}
                        {r.contact && <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{r.contact}</span>}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {r.contract ? <>{r.contract.name}<span className="block text-charcoal-ink/60">{words(r.contract.status)}, {day(r.contract.effective_from)} to {day(r.contract.effective_to)}</span></> : "No contract"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatNumber(r.seats?.seats ?? r.contract?.employee_count ?? 0)}
                        <span className="block text-xs text-charcoal-ink/60">{formatNumber(r.members_in_force)} active</span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r.seats?.seat_price_minor ?? r.contract?.price_per_employee_minor ? formatMinor((r.seats?.seat_price_minor ?? r.contract?.price_per_employee_minor) as number, "NGN") : "Not set"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(r.invoiced_minor, "NGN")}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(r.paid_minor, "NGN")}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatMinor(r.outstanding_minor, "NGN")}
                        {r.overdue_minor > 0 && <span className="block text-xs text-status-attention-text">{formatMinor(r.overdue_minor, "NGN")} overdue</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        {day(r.renewal_date)}
                        {r.renewal_within_60d && <Badge variant="attention" className="ml-1">within 60 days</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
