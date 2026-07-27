"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLedgerEntries, useFinanceAccounts, useCostCenters, financeKeys } from "@/lib/finance/queries";
import {
  postManualJournalAction,
  reverseJournalAction,
  type JournalLineInput,
} from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

const SOURCES = ["", "payment", "revenue_recognition", "commission", "refund", "wallet", "manual", "adjustment"];
const CURRENCIES = ["NGN", "GBP", "USD"];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

interface DraftLine {
  account_code: string;
  debit: string;
  credit: string;
  memo: string;
  cost_center_code: string;
}
const emptyLine = (): DraftLine => ({ account_code: "", debit: "", credit: "", memo: "", cost_center_code: "" });

export function LedgerBrowser() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(today());
  const [source, setSource] = useState("");
  const [showForm, setShowForm] = useState(false);

  const entries = useLedgerEntries({ from, to, source: source || undefined });
  const accounts = useFinanceAccounts();
  const costCenters = useCostCenters();

  // manual-entry draft
  const [entryDate, setEntryDate] = useState(today());
  const [currency, setCurrency] = useState("NGN");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + majorToMinor(l.debit), 0);
    const c = lines.reduce((s, l) => s + majorToMinor(l.credit), 0);
    return { debit: d, credit: c, balanced: d === c && d > 0 };
  }, [lines]);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setMessage(null);
    if (!totals.balanced) {
      setMessage({ ok: false, text: "Debits must equal credits and be non-zero." });
      return;
    }
    const payload: JournalLineInput[] = lines
      .filter((l) => l.account_code && (majorToMinor(l.debit) > 0 || majorToMinor(l.credit) > 0))
      .map((l) => ({
        account_code: l.account_code,
        debit_minor: majorToMinor(l.debit),
        credit_minor: majorToMinor(l.credit),
        memo: l.memo || undefined,
        cost_center_code: l.cost_center_code || undefined,
      }));
    if (payload.length < 2) {
      setMessage({ ok: false, text: "A journal entry needs at least two lines." });
      return;
    }
    setSaving(true);
    const res = await postManualJournalAction({ entry_date: entryDate, currency, memo, lines: payload });
    setSaving(false);
    if (!res.ok) {
      setMessage({ ok: false, text: res.error ?? "Could not post entry." });
      return;
    }
    const status = (res.data as { status?: string } | undefined)?.status;
    setMessage(
      status === "pending_approval"
        ? { ok: true, text: "This entry is above the approval threshold — sent to Approvals for a second finance officer to review before it posts." }
        : { ok: true, text: "Journal entry posted." },
    );
    setLines([emptyLine(), emptyLine()]);
    setMemo("");
    qc.invalidateQueries({ queryKey: financeKeys.all });
  }

  async function reverse(id: string) {
    const reason = window.prompt("Reason for this reversal?") ?? "";
    if (!reason) return;
    const res = await reverseJournalAction(id, reason);
    if (res.ok) qc.invalidateQueries({ queryKey: financeKeys.all });
    else window.alert(res.error ?? "Could not reverse entry.");
  }

  const accountOptions = accounts.data ?? [];

  return (
    <div className="space-y-6">
      <SectionCard
        title="Post a manual journal entry"
        description="Adjusting / accrual entries. Debits must equal credits; posting is blocked in a closed period."
        actions={
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Hide" : "New entry"}
          </Button>
        }
      >
        {!showForm ? (
          <p className="text-sm text-charcoal-ink/50">Use this for accruals, corrections and opening balances.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="je-date">Date</Label>
                <Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="je-cur">Currency</Label>
                <Select id="je-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="je-memo">Memo</Label>
                <Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Description" />
              </div>
            </div>

            <TableShell>
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <Th>Account</Th>
                  <Th right>Debit</Th>
                  <Th right>Credit</Th>
                  <Th>Cost center</Th>
                  <Th>Line memo</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-2">
                      <Select value={l.account_code} onChange={(e) => updateLine(i, { account_code: e.target.value })}>
                        <option value="">Select…</option>
                        {accountOptions.map((a) => (
                          <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Input inputMode="decimal" className="text-right" value={l.debit}
                        onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })} placeholder="0" />
                    </td>
                    <td className="py-2 pr-2">
                      <Input inputMode="decimal" className="text-right" value={l.credit}
                        onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })} placeholder="0" />
                    </td>
                    <td className="py-2 pr-2">
                      <Select value={l.cost_center_code} onChange={(e) => updateLine(i, { cost_center_code: e.target.value })}>
                        <option value="">Unassigned</option>
                        {(costCenters.data ?? []).map((c) => (
                          <option key={c.code} value={c.code}>{c.name}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Input value={l.memo} onChange={(e) => updateLine(i, { memo: e.target.value })} />
                    </td>
                    <td className="py-2 text-right">
                      {lines.length > 2 && (
                        <button type="button" className="text-xs text-charcoal-ink/50 hover:text-red-600"
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>Add line</Button>
              <div className="text-sm">
                <span className="text-charcoal-ink/60">Debits </span>
                <b className="tabular-nums">{formatMinor(totals.debit, currency)}</b>
                <span className="mx-2 text-charcoal-ink/40">·</span>
                <span className="text-charcoal-ink/60">Credits </span>
                <b className="tabular-nums">{formatMinor(totals.credit, currency)}</b>
                <span className="ml-2">
                  {totals.balanced ? (
                    <Badge variant="green">Balanced</Badge>
                  ) : (
                    <Badge variant="amber">Out of balance</Badge>
                  )}
                </span>
              </div>
            </div>

            {message && (
              <p className={`text-sm ${message.ok ? "text-brand-green" : "text-red-600"}`}>{message.text}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={submit} disabled={saving || !totals.balanced}>{saving ? "Posting…" : "Post entry"}</Button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="General ledger"
        description="Every posted journal entry and its lines. Corrections are made by reversing, never editing."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s === "" ? "All sources" : s.replace(/_/g, " ")}</option>
              ))}
            </Select>
          </div>
        }
      >
        {entries.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (entries.data ?? []).length === 0 ? (
          <CenterNote>No entries in this range.</CenterNote>
        ) : (
          <div className="space-y-4">
            {(entries.data ?? []).map((e) => (
              <div key={e.id} className="rounded-lg border border-charcoal-ink/10">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/5 bg-warm-ivory/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-charcoal-ink/50">#{e.entry_no}</span>
                    <span className="text-charcoal-ink/70">{e.entry_date}</span>
                    <Badge variant="grey">{e.source.replace(/_/g, " ")}</Badge>
                    <span className="text-charcoal-ink/80">{e.memo}</span>
                    {e.is_reversed && <Badge variant="amber">Reversed</Badge>}
                    {e.reversal_of && <Badge variant="blue">Reversal</Badge>}
                  </div>
                  {!e.is_reversed && !e.reversal_of && (
                    <button type="button" className="text-xs text-charcoal-ink/50 hover:text-red-600" onClick={() => reverse(e.id)}>
                      Reverse
                    </button>
                  )}
                </div>
                <TableShell>
                  <tbody>
                    {(e.lines ?? []).map((l, i) => (
                      <tr key={i} className="border-b border-charcoal-ink/5 last:border-0">
                        <td className="py-1.5 pl-3 pr-4 text-charcoal-ink/70">
                          <span className="font-mono text-xs text-charcoal-ink/40">{l.account_code}</span> {l.name}
                          {l.counterparty && <span className="text-charcoal-ink/40"> · {l.counterparty}</span>}
                          {l.cost_center_code && <span className="text-charcoal-ink/40"> · {l.cost_center_code}</span>}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-charcoal-ink">
                          {l.debit_minor ? formatMinor(l.debit_minor, e.currency) : ""}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-brand-green">
                          {l.credit_minor ? formatMinor(l.credit_minor, e.currency) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
