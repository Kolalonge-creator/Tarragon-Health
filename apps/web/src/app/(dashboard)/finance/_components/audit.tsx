"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFinanceAuditLog, useFinanceAuditActions } from "@/lib/finance/queries";
import { SectionCard, CenterNote, TableShell, Th, ReadFailure, StaleNote } from "./primitives";
import { formatPatientDateTime, lagosDayBounds, lagosDaysAgo, lagosToday } from "@/lib/format-date";

function summarizeEvent(event: Record<string, unknown>): string {
  const parts = Object.entries(event)
    .filter(([k]) => k !== "via_approval")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(" · ");
}

export function FinanceAuditLog() {
  // The range is two Lagos dates, and the query runs from the start of the first to the end of
  // today (Lagos). Both are stable text for the whole day, so the React Query key does not change on
  // every render (a bare `new Date().toISOString()` as `to` once made the log refetch forever and sit
  // on "Loading…"), and an action taken after the page opened still appears in the log.
  const [fromDate, setFromDate] = useState(lagosDaysAgo(30));
  const [action, setAction] = useState("");
  const today = lagosToday();
  const range = {
    from: lagosDayBounds(fromDate)?.start ?? lagosDayBounds(lagosDaysAgo(30))!.start,
    to: lagosDayBounds(today)!.end,
  };

  const log = useFinanceAuditLog({ ...range, action: action || undefined });
  const actions = useFinanceAuditActions();

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Every human-triggered finance action (posting or reversing a journal entry, opening/closing/
        locking a period, editing an account or tax rate, importing/matching/posting a settlement,
        running revenue recognition, and every approval decision) is logged here with who did it and
        when. Automated postings from real payments/commissions are not repeated here; they are already
        fully visible as ledger entries.
      </p>

      <SectionCard
        title="Activity log"
        description="Filter by date range and action."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={fromDate}
              max={today}
              // A cleared or half-typed date is not a date: keep the last good one rather than
              // throw (new Date("").toISOString() raises a RangeError and took the page down).
              onChange={(e) => lagosDayBounds(e.target.value) && setFromDate(e.target.value)}
              className="w-auto"
            />
            <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto">
              <option value="">All actions</option>
              {(actions.data ?? []).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
            {actions.isError && actions.data === undefined && (
              <span className="text-xs text-red-700">The action list could not be loaded.</span>
            )}
          </div>
        }
      >
        {log.isError && log.data !== undefined && <StaleNote what="The activity log" />}
        {log.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : log.isError && log.data === undefined ? (
          <ReadFailure what="The activity log" />
        ) : (log.data ?? []).length === 0 ? (
          <CenterNote>No finance activity in this range.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {(log.data ?? []).map((e) => (
                <tr key={e.id} className="border-b border-charcoal-ink/5 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">
                    {formatPatientDateTime(e.created_at)}
                  </td>
                  <td className="py-2 pr-4 text-charcoal-ink/70">{e.actor_name ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded bg-charcoal-ink/5 px-1.5 py-0.5 font-mono text-xs text-charcoal-ink/70">
                      {e.action}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-charcoal-ink/50">{summarizeEvent(e.event)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}
