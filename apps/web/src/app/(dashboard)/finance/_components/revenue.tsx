"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Scale, TrendingUp, CalendarClock } from "lucide-react";
import { useRevrecSummary, financeKeys } from "@/lib/finance/queries";
import { runRevenueRecognitionAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, formatNumber, ReadFailure, StaleNote } from "./primitives";
import { statTileValue } from "@/components/ui/stat-tile-value";

export function RevenueRecognition() {
  const qc = useQueryClient();
  const revrec = useRevrecSummary();
  const data = revrec.data;
  const isLoading = revrec.isLoading;
  // Unknown is not zero: a summary that did not load shows no figure, not "Deferred ₦0".
  const unknownHint = revrec.isError ? "Could not be loaded" : "Loading…";
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    const res = await runRevenueRecognitionAction();
    setRunning(false);
    if (!res.ok) {
      setMessage({ ok: false, text: res.error ?? "Could not run recognition." });
      return;
    }
    // A reply that is not a count is not "0 entries posted": say the run completed and the count was not returned.
    const posted = typeof res.data === "number" ? res.data : null;
    setMessage({
      ok: true,
      text:
        posted === null
          ? "Recognition run complete. The number of entries posted was not returned: check the ledger."
          : `Recognition run complete: ${posted} monthly entr${posted === 1 ? "y" : "ies"} posted.`,
    });
    qc.invalidateQueries({ queryKey: financeKeys.all });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        A payment for a service the patient has not used yet is held in Deferred revenue and
        recognised straight-line across the period it covers (ASC 606 / IFRS 15), one journal entry
        per elapsed month. Recognition runs automatically on the 1st of each month; you can also
        run it on demand.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Scale} label="Deferred (unrecognised)" {...statTileValue(data ? formatMinor(data.total_deferred_minor, "NGN") : null, unknownHint)} />
        <StatTile icon={TrendingUp} label="Recognised to date" {...statTileValue(data ? formatMinor(data.total_recognized_minor, "NGN") : null, unknownHint)} />
        <StatTile icon={CalendarClock} label="Active schedules" {...statTileValue(data ? formatNumber(data.active_schedules) : null, unknownHint)} />
      </div>

      <SectionCard
        title="Recognition schedules"
        description="Each paid period, recognised straight-line to its end date."
        actions={<Button size="sm" onClick={run} disabled={running}>{running ? "Running…" : "Run recognition now"}</Button>}
      >
        {message && <p className={`mb-3 text-sm ${message.ok ? "text-brand-green" : "text-red-600"}`}>{message.text}</p>}
        {revrec.isError && data !== undefined && <StaleNote what="Recognition schedules" />}
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : revrec.isError && data === undefined ? (
          <ReadFailure what="Recognition schedules" />
        ) : (data?.schedules ?? []).length === 0 ? (
          <CenterNote>No recognition schedules yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Source</Th>
                <Th>Period</Th>
                <Th right>Total</Th>
                <Th right>Recognised</Th>
                <Th right>Remaining</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.schedules ?? []).map((s) => (
                <tr key={s.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{s.source_kind.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{s.period_start} → {s.period_end}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.total_minor, s.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-brand-green">{formatMinor(s.recognized_minor, s.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.remaining_minor, s.currency)}</td>
                  <td className="py-2">
                    <Badge variant={s.status === "completed" ? "green" : s.status === "active" ? "blue" : "grey"}>{s.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}
