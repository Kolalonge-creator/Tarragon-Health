"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useEmployerBillingSummary, financeKeys } from "@/lib/finance/queries";
import { upsertEmployerBillingConfigAction, deleteEmployerBillingConfigAction } from "@/lib/finance/actions";
import type { EmployerBillingSummaryRow } from "@/lib/finance/schemas";
import { lagosToday } from "@/lib/format-date";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

/**
 * docs/FULL_SPECIFICATION_V4.md §94.12 — "Eligible employees x Price per
 * member = Monthly invoice". Every corporate/hmo org, its roster's eligible/
 * activated headcount (public.employer_roster_counts), its current per-member
 * rate if set, and the resulting estimate. Setting a rate is standard B2B
 * per-seat pricing for platform access, not capitation (I8) — it never
 * changes what care a patient receives. This is an internal estimate for
 * finance review only; it does not generate or send an invoice.
 */
export function EmployerBilling() {
  const qc = useQueryClient();
  const summary = useEmployerBillingSummary();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [f, setF] = useState({ price: "", currency: "NGN", effective_from: lagosToday(), notes: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  function startEdit(row: EmployerBillingSummaryRow) {
    setEditingOrgId(row.organisation_id);
    setF({
      price: row.price_per_member_minor ? String(row.price_per_member_minor / 100) : "",
      currency: row.currency ?? "NGN",
      effective_from: row.effective_from ?? lagosToday(),
      notes: row.notes ?? "",
    });
    setMsg(null);
  }

  async function save(row: EmployerBillingSummaryRow) {
    setMsg(null);
    if (!f.price) return setMsg({ ok: false, text: "Price per member is required." });
    const res = await upsertEmployerBillingConfigAction({
      id: row.billing_config_id ?? undefined,
      organisation_id: row.organisation_id,
      price_per_member_minor: majorToMinor(f.price),
      currency: f.currency,
      effective_from: f.effective_from,
      is_active: true,
      notes: f.notes || undefined,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save billing config." });
    setMsg({ ok: true, text: "Billing config saved." });
    setEditingOrgId(null);
    invalidate();
  }

  async function remove(row: EmployerBillingSummaryRow) {
    if (!row.billing_config_id) return;
    const res = await deleteEmployerBillingConfigAction(row.billing_config_id);
    if (res.ok) invalidate();
    else setMsg({ ok: false, text: res.error ?? "Could not remove billing config." });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Per-member platform pricing for employer/HMO organisations. Eligible/activated counts come
        straight from each org&apos;s roster. This is an internal estimate for finance review. It
        does not send an invoice.
      </p>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard title="Employer billing" description="One row per active corporate/HMO organisation.">
        {summary.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (summary.data ?? []).length === 0 ? (
          <CenterNote>No corporate or HMO organisations yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Organisation</Th>
                <Th right>Eligible</Th>
                <Th right>Activated</Th>
                <Th right>Price / member</Th>
                <Th right>Monthly estimate</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(summary.data ?? []).map((row) => (
                <>
                  <tr key={row.organisation_id} className="border-b border-charcoal-ink/5">
                    <td className="py-1.5 pr-4 text-charcoal-ink/80">
                      {row.organisation_name}
                      <span className="ml-1 text-xs text-charcoal-ink/40">
                        ({row.organisation_type === "hmo" ? "HMO" : "Corporate"})
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{row.eligible_count}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{row.activated_count}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {row.price_per_member_minor
                        ? formatMinor(row.price_per_member_minor, row.currency ?? "NGN")
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {row.monthly_invoice_estimate_minor !== null
                        ? formatMinor(row.monthly_invoice_estimate_minor, row.currency ?? "NGN")
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs text-charcoal-ink/50 hover:text-brand-green"
                          onClick={() => startEdit(row)}
                        >
                          {row.billing_config_id ? "Edit" : "Set rate"}
                        </button>
                        {row.billing_config_id && (
                          <button
                            type="button"
                            className="text-xs text-charcoal-ink/50 hover:text-red-600"
                            onClick={() => remove(row)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editingOrgId === row.organisation_id && (
                    <tr key={`${row.organisation_id}-form`} className="border-b border-charcoal-ink/5 bg-warm-ivory/40">
                      <td colSpan={6} className="py-3 pr-4">
                        <div className="grid gap-3 sm:grid-cols-5">
                          <div>
                            <Label>Price / member</Label>
                            <Input
                              inputMode="decimal"
                              value={f.price}
                              onChange={(e) => setF((p) => ({ ...p, price: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Currency</Label>
                            <Select
                              value={f.currency}
                              onChange={(e) => setF((p) => ({ ...p, currency: e.target.value }))}
                            >
                              <option value="NGN">NGN</option>
                              <option value="GBP">GBP</option>
                              <option value="USD">USD</option>
                            </Select>
                          </div>
                          <div>
                            <Label>Effective from</Label>
                            <Input
                              type="date"
                              value={f.effective_from}
                              onChange={(e) => setF((p) => ({ ...p, effective_from: e.target.value }))}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Notes (optional)</Label>
                            <Input value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
                          </div>
                          <div className="sm:col-span-5 flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditingOrgId(null)}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => save(row)}>
                              Save
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}
