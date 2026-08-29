"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFraudSignals, financeKeys } from "@/lib/finance/queries";
import type { FraudSignal } from "@/lib/finance/schemas";
import { resolveFraudSignalAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor } from "./primitives";

const SIGNAL_TYPE_LABEL: Record<FraudSignal["signal_type"], string> = {
  duplicate_transaction: "Duplicate charge",
  rapid_velocity: "Rapid payment velocity",
  refund_concentration: "Refund concentration",
  unusual_amount: "Unusual amount",
};

const SEVERITY_BADGE: Record<FraudSignal["severity"], "red" | "amber" | "green"> = {
  high: "red",
  medium: "amber",
  low: "green",
};

export function FraudSignals() {
  const qc = useQueryClient();
  const { data: signals, isLoading } = useFraudSignals("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  async function resolve(id: string, status: "resolved" | "ignored") {
    const res = await resolveFraudSignalAction(id, status);
    if (res.ok) {
      setMsg({ ok: true, text: status === "resolved" ? "Signal marked resolved." : "Signal ignored." });
      invalidate();
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not update the signal." });
    }
  }

  return (
    <div className="space-y-6">
      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard
        title="Payment fraud signals"
        description="Daily sweep for duplicate charges, unusually fast/frequent payments, refund concentration, and out-of-range amounts. Detection only — nothing here blocks a payment or reverses a charge."
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (signals ?? []).length === 0 ? (
          <CenterNote>No open signals. The last sweep found nothing worth flagging. ✓</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Detected</Th>
                <Th>Signal</Th>
                <Th right>Amount</Th>
                <Th>Detail</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(signals ?? []).map((s) => (
                <SignalRow key={s.id} signal={s} onResolve={resolve} />
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}

function SignalRow({
  signal,
  onResolve,
}: {
  signal: FraudSignal;
  onResolve: (id: string, status: "resolved" | "ignored") => void;
}) {
  const currency = signal.currency ?? "NGN";
  const note = typeof signal.detail?.note === "string" ? signal.detail.note : null;
  return (
    <tr className="border-b border-charcoal-ink/5">
      <td className="py-2 pr-4 text-charcoal-ink/60">{signal.detected_at.slice(0, 10)}</td>
      <td className="py-2 pr-4">
        <Badge variant={SEVERITY_BADGE[signal.severity]}>
          {SIGNAL_TYPE_LABEL[signal.signal_type] ?? signal.signal_type}
        </Badge>
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {signal.amount_minor != null ? formatMinor(signal.amount_minor, currency) : "—"}
      </td>
      <td className="py-2 pr-4 max-w-md text-xs text-charcoal-ink/60">{note ?? "—"}</td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onResolve(signal.id, "resolved")}>Resolved</Button>
          <Button size="sm" variant="outline" onClick={() => onResolve(signal.id, "ignored")}>Ignore</Button>
        </div>
      </td>
    </tr>
  );
}
