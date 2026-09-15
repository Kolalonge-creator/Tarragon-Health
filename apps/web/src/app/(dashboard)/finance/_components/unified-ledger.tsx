"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useUnifiedLedger } from "@/lib/finance/queries";
import { SectionCard, CenterNote, TableShell, Th, formatMinor } from "./primitives";

/**
 * §91.12 unified transaction ledger — a payer-facing view (payer, recipient,
 * service, amount, status, method) built on top of `finance_unified_ledger`,
 * distinct from the raw double-entry journal at /finance/ledger. Looks up one
 * patient's transaction history by profile id — the same shape Phase 6's
 * patient-facing financial profile will reuse for a patient's own view.
 */
export function UnifiedLedgerLookup() {
  const [profileId, setProfileId] = useState("");
  const [submitted, setSubmitted] = useState("");

  const ledger = useUnifiedLedger({ profileId: submitted || undefined });

  return (
    <SectionCard
      title="Look up a patient's transactions"
      description="Every payment, refund, and failed charge for one patient, joined against the general ledger. Enter the patient's profile ID."
    >
      <form
        className="mb-4 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(profileId.trim());
        }}
      >
        <div className="flex-1">
          <Label htmlFor="unified-ledger-profile-id">Patient profile ID</Label>
          <Input
            id="unified-ledger-profile-id"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-md bg-brand-green px-4 text-sm font-medium text-white disabled:opacity-50"
          disabled={!profileId.trim()}
        >
          Look up
        </button>
      </form>

      {!submitted && <CenterNote>Enter a profile ID to see their transaction history.</CenterNote>}

      {submitted && ledger.isLoading && <CenterNote>Loading…</CenterNote>}

      {submitted && ledger.isError && (
        <CenterNote>
          Could not load this profile&apos;s transactions. Check the ID is correct.
        </CenterNote>
      )}

      {submitted && ledger.data && ledger.data.length === 0 && (
        <CenterNote>No transactions found for this patient.</CenterNote>
      )}

      {submitted && ledger.data && ledger.data.length > 0 && (
        <TableShell>
          <thead>
            <tr className="border-b border-charcoal-ink/10">
              <Th>Date</Th>
              <Th>Service</Th>
              <Th>Payer</Th>
              <Th>Recipient</Th>
              <Th right>Amount</Th>
              <Th>Method</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.data.map((row) => (
              <tr key={row.payment_transaction_id ?? row.entry_id} className="border-b border-charcoal-ink/5">
                <td className="py-2 pr-4">{new Date(row.posted_at).toLocaleDateString("en-NG")}</td>
                <td className="py-2 pr-4">{row.service_label}</td>
                <td className="py-2 pr-4">{row.payer_label}</td>
                <td className="py-2 pr-4">{row.recipient_label}</td>
                <td className="py-2 pr-4 text-right">
                  {row.direction === "money_out" ? "−" : ""}
                  {formatMinor(row.amount_minor, row.currency)}
                </td>
                <td className="py-2 pr-4 capitalize">{row.method ?? "—"}</td>
                <td className="py-2 pr-4">
                  <Badge variant={row.status === "completed" ? "green" : "red"}>{row.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </SectionCard>
  );
}
