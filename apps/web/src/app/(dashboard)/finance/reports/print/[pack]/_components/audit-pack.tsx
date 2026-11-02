"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  useTrialBalance,
  useAllLedgerEntries,
  useReconciliationSummary,
  useApAging,
  useBudgetVariance,
  useApprovalHistory,
  useAllFinanceAuditLog,
} from "@/lib/finance/queries";
import { ReportLetterhead } from "./letterhead";
import { PrintToolbar } from "./print-toolbar";
import { PackBlocked, PackStaleBanner } from "./pack-notices";
import { packSource, summarisePackSources } from "./pack-sources";
import { formatPatientDate, formatPatientDateTime, lagosDayBounds } from "@/lib/format-date";
import {
  PrintSection,
  PrintTable,
  PrintTh,
  PrintTd,
  PrintEmpty,
  PrintTruncation,
  Disclaimer,
  formatMinor,
} from "./print-primitives";
import { PACK_APPROVAL_LIMIT, PACK_AUDIT_LOG_LIMIT, PACK_LEDGER_LIMIT, hitLimit } from "@/lib/finance/row-limits";

export function AuditPack({ from, to, currency }: { from: string; to: string; currency: string }) {
  const tb = useTrialBalance(to, currency);
  // The pack reads the whole ledger and audit log a page at a time, and prints a warning in the
  // section if a ceiling stopped it, because it calls itself the full record.
  const gl = useAllLedgerEntries({ from, to });
  const recon = useReconciliationSummary();
  const apAging = useApAging();
  const variance = useBudgetVariance(from, to, currency);
  const approvals = useApprovalHistory(PACK_APPROVAL_LIMIT);
  // The period is two Lagos dates. Reading them as UTC days put 00:00 to 01:00 Lagos time into the
  // previous day, and comparing a timestamp to the text "YYYY-MM-DDT23:59:59" dropped the last second.
  const range = useMemo(() => {
    const a = lagosDayBounds(from);
    const b = lagosDayBounds(to);
    return { start: a?.start ?? `${from}T00:00:00+01:00`, end: b?.end ?? `${to}T23:59:59.999+01:00`, valid: Boolean(a && b) };
  }, [from, to]);
  const auditLog = useAllFinanceAuditLog({ from: range.start, to: range.end });

  const approvalsInRange = useMemo(() => {
    if (!range.valid) return [];
    const start = Date.parse(range.start);
    const end = Date.parse(range.end);
    return (approvals.data ?? []).filter((a) => {
      const t = Date.parse(a.requested_at);
      return Number.isFinite(t) && t >= start && t <= end;
    });
  }, [approvals.data, range]);

  // A printed audit pack that says "No logged finance activity in this range" is evidence to the
  // reader. If a source did not load, the pack is not built, and says why. See pack-sources.ts.
  const { failed, stale, loading } = summarisePackSources([
    packSource("trial balance", tb),
    packSource("general ledger", gl),
    packSource("settlement reconciliation", recon),
    packSource("accounts payable aging", apAging),
    packSource("budget variance", variance),
    packSource("approval history", approvals),
    packSource("finance audit trail", auditLog),
  ]);

  if (failed.length > 0) {
    return (
      <PackBlocked
        title="Audit & management pack"
        subtitle={`${from} to ${to} · ${currency}`}
        failed={failed}
      />
    );
  }

  return (
    <div>
      <PrintToolbar loading={loading} />
      <ReportLetterhead
        title="Audit & management pack"
        subtitle={`${from} to ${to} · ${currency} · trial balance as of ${to}`}
      />

      <PackStaleBanner stale={stale} />

      <Disclaimer>
        A working folder assembled from the live ledger and the finance system&apos;s own audit trail,
        not itself an audit opinion, an auditor&apos;s report, or a substitute for independent testing.
        Reconciliation and AP aging below are point-in-time snapshots (as of today), not restated for
        the date range.
      </Disclaimer>

      <PrintSection title="Significant accounting policies" description="Draft: for the reviewing auditor to confirm or amend, not asserted as final.">
        <ul className="list-disc space-y-1 pl-4 text-xs text-charcoal-ink/70">
          <li>Amounts are recorded in minor currency units (kobo/pence/cents) and presented above in major units.</li>
          <li>Revenue from a service bought up front is deferred and recognised over the period it covers, not at the point of cash receipt (Finance → Revenue recognition).</li>
          <li>The books are prepared on a going-concern basis.</li>
          <li>All journal entries post through a single balance-validated posting primitive; every entry must debit and credit equally in the same currency, enforced at the database level, not just in the UI.</li>
        </ul>
      </PrintSection>

      <PrintSection title="Trial balance" description={`As of ${to} · ${currency}`}>
        {tb.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (tb.data ?? []).length === 0 ? (
          <PrintEmpty>No ledger activity.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>Account</PrintTh><PrintTh right>Debit</PrintTh><PrintTh right>Credit</PrintTh></tr>
            </thead>
            <tbody>
              {(tb.data ?? []).map((r) => (
                <tr key={r.code}>
                  <PrintTd>{r.code}: {r.name}</PrintTd>
                  <PrintTd right>{r.debit_minor ? formatMinor(r.debit_minor, currency) : ""}</PrintTd>
                  <PrintTd right>{r.credit_minor ? formatMinor(r.credit_minor, currency) : ""}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection title="Settlement reconciliation" description="Current unreconciled position, as of today.">
        {recon.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <>
            <PrintTable>
              <thead>
                <tr>
                  <PrintTh>Provider</PrintTh><PrintTh>Settlement date</PrintTh><PrintTh right>Net</PrintTh>
                  <PrintTh right>Variance</PrintTh><PrintTh>Status</PrintTh>
                </tr>
              </thead>
              <tbody>
                {(recon.data?.settlements ?? []).length === 0 ? (
                  <tr><td colSpan={5}><PrintEmpty>No settlements recorded.</PrintEmpty></td></tr>
                ) : (
                  (recon.data?.settlements ?? []).map((s) => (
                    <tr key={s.id}>
                      <PrintTd>{s.provider}</PrintTd>
                      <PrintTd muted>{s.settlement_date}</PrintTd>
                      <PrintTd right>{formatMinor(s.net_minor, s.currency)}</PrintTd>
                      <PrintTd right muted>{formatMinor(s.variance_minor, s.currency)}</PrintTd>
                      <PrintTd>{s.status}</PrintTd>
                    </tr>
                  ))
                )}
              </tbody>
            </PrintTable>
            <p className="mt-2 text-xs text-charcoal-ink/60">
              {recon.data?.unmatched.length ?? 0} unmatched payment event(s) awaiting a settlement match.
            </p>
          </>
        )}
      </PrintSection>

      <PrintSection title="Accounts payable aging" description="Approved, unpaid bills, as of today." breakBefore>
        {apAging.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (apAging.data ?? []).length === 0 ? (
          <PrintEmpty>Nothing outstanding.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>Bill</PrintTh><PrintTh>Vendor</PrintTh><PrintTh>Due</PrintTh><PrintTh right>Days overdue</PrintTh><PrintTh right>Amount</PrintTh></tr>
            </thead>
            <tbody>
              {(apAging.data ?? []).map((r) => (
                <tr key={r.id}>
                  <PrintTd muted>#{r.bill_no}</PrintTd>
                  <PrintTd>{r.vendor_name}</PrintTd>
                  <PrintTd muted>{r.due_date ?? "—"}</PrintTd>
                  <PrintTd right muted>{r.days_overdue > 0 ? r.days_overdue : ""}</PrintTd>
                  <PrintTd right>{formatMinor(r.amount_minor, r.currency)}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection title="Budget vs. actual" description={`${from} to ${to} · ${currency}`}>
        {variance.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (variance.data ?? []).length === 0 ? (
          <PrintEmpty>No budgets configured for this period.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>Account</PrintTh><PrintTh right>Budget</PrintTh><PrintTh right>Actual</PrintTh><PrintTh right>Variance</PrintTh></tr>
            </thead>
            <tbody>
              {(variance.data ?? []).map((r, i) => (
                <tr key={`${r.account_code}-${r.cost_center_code ?? "none"}-${i}`}>
                  <PrintTd>{r.account_name}{r.cost_center_code ? ` · ${r.cost_center_code}` : ""}</PrintTd>
                  <PrintTd right>{formatMinor(r.budget_minor, currency)}</PrintTd>
                  <PrintTd right>{formatMinor(r.actual_minor, currency)}</PrintTd>
                  <PrintTd right muted>{formatMinor(r.variance_minor, currency)}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection title="Approval history" description={`Maker-checker decisions requested ${from} to ${to}.`} breakBefore>
        {hitLimit(approvals.data?.length, PACK_APPROVAL_LIMIT) && <PrintTruncation shown={PACK_APPROVAL_LIMIT} what="reviewed approvals" />}
        {approvals.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : approvalsInRange.length === 0 ? (
          <PrintEmpty>No approval requests in this range.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>Requested</PrintTh><PrintTh>Type</PrintTh><PrintTh>By</PrintTh><PrintTh>Decision</PrintTh><PrintTh>By</PrintTh></tr>
            </thead>
            <tbody>
              {approvalsInRange.map((a) => (
                <tr key={a.id}>
                  <PrintTd muted>{formatPatientDate(a.requested_at)}</PrintTd>
                  <PrintTd>{a.request_type.replace(/_/g, " ")}</PrintTd>
                  <PrintTd muted>{a.requested_by_name ?? "—"}</PrintTd>
                  <PrintTd><Badge variant={a.status === "approved" ? "green" : "red"}>{a.status}</Badge></PrintTd>
                  <PrintTd muted>{a.reviewed_by_name ?? "—"}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection title="Finance system audit trail" description="Every human-triggered finance action logged in this range (posting, period locks, edits, approvals, settlement matching).">
        {hitLimit(auditLog.data?.length, PACK_AUDIT_LOG_LIMIT) && <PrintTruncation shown={PACK_AUDIT_LOG_LIMIT} what="log rows" />}
        {auditLog.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (auditLog.data ?? []).length === 0 ? (
          <PrintEmpty>No logged finance activity in this range.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>When</PrintTh><PrintTh>Who</PrintTh><PrintTh>Action</PrintTh></tr>
            </thead>
            <tbody>
              {(auditLog.data ?? []).map((e) => (
                <tr key={e.id}>
                  <PrintTd muted>{formatPatientDateTime(e.created_at)}</PrintTd>
                  <PrintTd>{e.actor_name ?? "—"}</PrintTd>
                  <PrintTd muted>{e.action}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection title="General ledger detail" description={`Every posted entry, ${from} to ${to}.`} breakBefore>
        {hitLimit(gl.data?.length, PACK_LEDGER_LIMIT) && <PrintTruncation shown={PACK_LEDGER_LIMIT} what="entries" />}
        {gl.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (gl.data ?? []).length === 0 ? (
          <PrintEmpty>No entries in this range.</PrintEmpty>
        ) : (
          <div className="space-y-3">
            {(gl.data ?? []).map((entry) => (
              <div key={entry.id} className="print-avoid-break border-b border-charcoal-ink/10 pb-2">
                <p className="text-xs text-charcoal-ink/70">
                  <span className="font-mono text-charcoal-ink/40">#{entry.entry_no}</span>{" "}
                  {entry.entry_date} · {entry.source}
                  {entry.memo ? ` · ${entry.memo}` : ""}
                  {entry.is_reversed && <span className="ml-1 text-red-600">(reversed)</span>}
                </p>
                <PrintTable>
                  <tbody>
                    {(entry.lines ?? []).map((l, i) => (
                      <tr key={i}>
                        <PrintTd muted>{l.account_code} {l.name ?? ""}</PrintTd>
                        <PrintTd right>{l.debit_minor ? formatMinor(l.debit_minor, entry.currency) : ""}</PrintTd>
                        <PrintTd right>{l.credit_minor ? formatMinor(l.credit_minor, entry.currency) : ""}</PrintTd>
                      </tr>
                    ))}
                  </tbody>
                </PrintTable>
              </div>
            ))}
          </div>
        )}
      </PrintSection>
    </div>
  );
}
