"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePendingApprovals, useApprovalHistory, financeKeys } from "@/lib/finance/queries";
import type { PendingApproval, ApprovalHistoryEntry } from "@/lib/finance/schemas";
import { approveRequestAction, rejectRequestAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor } from "./primitives";
import { formatPatientDateTime } from "@/lib/format-date";

type RequestType = (PendingApproval | ApprovalHistoryEntry)["request_type"];

// Switches on the union type, not `string` -- if a future migration adds a
// fourth request_type without updating this file, TypeScript refuses to
// compile it (the `never` assignment below) instead of silently falling
// through to the manual_journal rendering, which is exactly the bug this
// file was fixed for once already (a journal_reversal row rendering as a
// mislabelled "Manual journal · ₦0" request).
export function requestLabel(type: RequestType): string {
  switch (type) {
    case "period_lock":
      return "Period lock";
    case "journal_reversal":
      return "Reversal";
    case "manual_journal":
      return "Manual journal";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function requestSummary(row: PendingApproval | ApprovalHistoryEntry): string {
  const { payload, request_type: type } = row;
  switch (type) {
    case "period_lock":
      return `Lock accounting period ${String(payload.period_month ?? "")}`;
    case "journal_reversal": {
      const target = row.reversal_target;
      const amount = target ? formatMinor(target.amount_minor, target.currency) : "an entry";
      const entryLabel = target ? `entry #${target.entry_no}` : "an entry that no longer exists";
      return `Reverse ${entryLabel}: ${amount} · ${String(payload.reason ?? "")}`;
    }
    case "manual_journal": {
      const lines = Array.isArray(payload.lines)
        ? (payload.lines as { debit_minor?: number; credit_minor?: number }[])
        : [];
      const max = lines.reduce((m, l) => Math.max(m, l.debit_minor ?? 0, l.credit_minor ?? 0), 0);
      return `Journal entry: ${formatMinor(max, String(payload.currency ?? "NGN"))} · ${String(payload.memo ?? "")}`;
    }
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function ApprovalsQueue() {
  const qc = useQueryClient();
  const pending = usePendingApprovals();
  const history = useApprovalHistory();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  async function approve(id: string) {
    setBusy(id);
    setMsg(null);
    const res = await approveRequestAction(id, note[id] ?? "");
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not approve." });
    // finance_approve_request can resolve a journal_reversal request to a
    // clean auto-rejection (never a thrown error) instead of posting, when
    // it can't actually be carried out: see the row-locking migration.
    const data = res.data as { status?: string; reason?: string } | null;
    if (data?.status === "rejected") {
      const reasonText =
        data.reason === "entry_already_reversed"
          ? "this entry was already reversed by another approved request"
          : data.reason === "entry_not_found"
            ? "the entry this request targets no longer exists"
            : "the reversal could not be completed";
      setMsg({ ok: true, text: `Not posted: ${reasonText}, so this request was auto-rejected.` });
    } else {
      setMsg({ ok: true, text: "Approved and posted." });
    }
    invalidate();
  }

  async function reject(id: string) {
    const reason = note[id] ?? window.prompt("Reason for rejecting?") ?? "";
    if (!reason) return;
    setBusy(id);
    setMsg(null);
    const res = await rejectRequestAction(id, reason);
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not reject." });
    setMsg({ ok: true, text: "Rejected." });
    invalidate();
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        A four-eyes control: a manual journal entry at or above the configured threshold, and locking
        an accounting period, wait here for a <b>different</b> finance officer to review: the person
        who requested it cannot approve their own request (enforced at the database level, not just
        in this UI).
      </p>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard
        title="Pending approval"
        description="Nothing here posts to the ledger until a second finance officer approves it."
      >
        {pending.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : pending.isError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Could not load pending approvals. This does NOT mean there is nothing waiting: reload the
            page before trusting an empty queue.
          </p>
        ) : (pending.data ?? []).length === 0 ? (
          <CenterNote>Nothing waiting on approval. ✓</CenterNote>
        ) : (
          <div className="space-y-3">
            {(pending.data ?? []).map((r) => (
              <div key={r.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Badge variant="amber">{requestLabel(r.request_type)}</Badge>
                    <span className="ml-2 text-sm text-charcoal-ink/80">{requestSummary(r)}</span>
                  </div>
                  <span className="text-xs text-charcoal-ink/50">
                    Requested by {r.requested_by_name ?? "someone"} · {formatPatientDateTime(r.requested_at)}
                  </span>
                </div>
                {r.reason && <p className="mt-1 text-xs text-charcoal-ink/60">Reason: {r.reason}</p>}
                {r.is_own_request ? (
                  <p className="mt-2 text-xs text-charcoal-ink/50">
                    You requested this: a different finance officer must review it.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-charcoal-ink/15 px-2 py-1 text-xs"
                      placeholder="Optional note"
                      value={note[r.id] ?? ""}
                      onChange={(e) => setNote((p) => ({ ...p, [r.id]: e.target.value }))}
                    />
                    <Button size="sm" disabled={busy === r.id} onClick={() => approve(r.id)}>
                      {busy === r.id ? "Working…" : "Approve"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => reject(r.id)}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recently reviewed" description="Approved and rejected requests.">
        {history.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : history.isError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load approval history.</p>
        ) : (history.data ?? []).length === 0 ? (
          <CenterNote>No reviewed requests yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Request</Th>
                <Th>Requested by</Th>
                <Th>Reviewed by</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 text-charcoal-ink/70">{requestSummary(r)}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{r.requested_by_name ?? "—"}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">
                    {r.reviewed_by_name ?? "—"}
                    {r.review_note && <span className="text-charcoal-ink/40"> · {r.review_note}</span>}
                  </td>
                  <td className="py-2">
                    <Badge variant={r.status === "approved" ? "green" : "red"}>{r.status}</Badge>
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
