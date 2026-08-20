"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { NAV_ICON } from "@/lib/icons";
import { useComplianceCalendar, financeKeys, fetchComplianceSuggestedAmount } from "@/lib/finance/queries";
import { markFiledAction, unmarkFiledAction } from "@/lib/finance/actions";
import type { ComplianceObligation } from "@/lib/finance/schemas";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

const STATUS_VARIANT: Record<string, "green" | "amber" | "red" | "grey"> = {
  filed: "green",
  due_soon: "amber",
  overdue: "red",
  upcoming: "grey",
};

export function ComplianceCalendar() {
  const qc = useQueryClient();
  const calendar = useComplianceCalendar(3);
  const [open, setOpen] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [suggestion, setSuggestion] = useState<{ minor: number; basis: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  const counts = useMemo(() => {
    const rows = calendar.data ?? [];
    return {
      overdue: rows.filter((r) => r.status === "overdue").length,
      dueSoon: rows.filter((r) => r.status === "due_soon").length,
      upcoming: rows.filter((r) => r.status === "upcoming").length,
    };
  }, [calendar.data]);

  async function openMarkFiled(o: ComplianceObligation) {
    setOpen(`${o.obligation_code}-${o.period_label}`);
    setRef("");
    setAmount("");
    setSuggestion(null);
    if (o.obligation_code === "vat_monthly" || o.obligation_code === "wht_monthly") {
      try {
        const s = await fetchComplianceSuggestedAmount(o.obligation_code, o.period_label);
        if (s.suggested_amount_minor != null) {
          setSuggestion({ minor: s.suggested_amount_minor, basis: s.basis ?? "" });
          setAmount((s.suggested_amount_minor / 100).toString());
        }
      } catch {
        // suggestion is a convenience only — a failed fetch still leaves manual entry available
      }
    }
  }

  async function markFiled(o: ComplianceObligation) {
    setMsg(null);
    const res = await markFiledAction({
      obligation_code: o.obligation_code,
      period_label: o.period_label,
      due_date: o.due_date,
      remittance_reference: ref,
      amount_minor: amount ? majorToMinor(amount) : undefined,
      currency: "NGN",
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save." });
    setMsg({ ok: true, text: "Marked as filed." });
    setOpen(null);
    setRef("");
    setAmount("");
    setSuggestion(null);
    invalidate();
  }

  async function unmarkFiled(o: ComplianceObligation) {
    const res = await unmarkFiledAction(o.obligation_code, o.period_label);
    if (res.ok) invalidate();
    else setMsg({ ok: false, text: res.error ?? "Could not undo." });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Nigeria&apos;s recurring statutory filings: VAT, WHT, PAYE, pension (PRA 2014), and annual CIT.
        Cadences shown are the standard statutory day-of-month figures as a starting point; confirm exact
        dates with your tax adviser. This is a tracker, not a filing engine: it never files anything with
        FIRS/PENCOM itself; &quot;mark as filed&quot; just records that your team remitted it, with a
        reference, and is logged in the audit trail.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={NAV_ICON.warning} label="Overdue" value={String(counts.overdue)} />
        <StatTile icon={NAV_ICON.duration} label="Due within 7 days" value={String(counts.dueSoon)} />
        <StatTile icon={NAV_ICON.compliance} label="Upcoming" value={String(counts.upcoming)} />
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard title="Filing calendar" description="Next 3 months, plus last month's obligations.">
        {calendar.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (calendar.data ?? []).length === 0 ? (
          <CenterNote>Nothing configured.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Obligation</Th>
                <Th>Agency</Th>
                <Th>Period</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(calendar.data ?? []).map((o) => (
                <tr key={`${o.obligation_code}-${o.period_label}`} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 text-charcoal-ink/80" title={o.description ?? undefined}>
                    {o.obligation_name}
                  </td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{o.agency}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{o.period_label}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{o.due_date}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={STATUS_VARIANT[o.status] ?? "grey"}>{o.status.replace(/_/g, " ")}</Badge>
                    {o.filed_at && o.remittance_reference && (
                      <span className="ml-1 text-xs text-charcoal-ink/40">· {o.remittance_reference}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {o.status === "filed" ? (
                      <button
                        type="button"
                        className="text-xs text-charcoal-ink/50 hover:text-red-600"
                        onClick={() => unmarkFiled(o)}
                      >
                        Undo
                      </button>
                    ) : open === `${o.obligation_code}-${o.period_label}` ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            className="h-7 w-24 text-right text-xs"
                            inputMode="decimal"
                            placeholder="Amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                          <Input
                            className="h-7 w-32 text-xs"
                            placeholder="Reference"
                            value={ref}
                            onChange={(e) => setRef(e.target.value)}
                          />
                          <Button size="sm" onClick={() => markFiled(o)}>Save</Button>
                        </div>
                        {suggestion && (
                          <span className="text-[11px] text-charcoal-ink/40">
                            Suggested from the ledger: {formatMinor(suggestion.minor, "NGN")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => openMarkFiled(o)}>
                        Mark filed
                      </Button>
                    )}
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
