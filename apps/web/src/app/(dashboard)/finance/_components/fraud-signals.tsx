"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFraudSignals, financeKeys } from "@/lib/finance/queries";
import type { FraudSignal } from "@/lib/finance/schemas";
import { resolveFraudSignalAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor } from "./primitives";

const SEVERITY_VARIANT: Record<string, "red" | "amber" | "grey"> = {
  high: "red",
  medium: "amber",
  low: "grey",
};

const SIGNAL_LABEL: Record<string, string> = {
  duplicate_transaction: "Duplicate charge",
  rapid_velocity: "Rapid payment velocity",
  refund_concentration: "Refund concentration",
  unusual_amount: "Unusual amount",
  chargeback: "Chargeback / dispute",
};

function SignalRow({ signal, onResolve }: { signal: FraudSignal; onResolve: (id: string, status: "resolved" | "ignored") => void }) {
  const note = (signal.detail as { note?: string } | null)?.note;
  return (
    <tr className="border-b border-charcoal-ink/5 text-sm">
      <td className="py-2 pr-4">{new Date(signal.detected_at).toLocaleString("en-NG")}</td>
      <td className="py-2 pr-4">
        <Badge variant={SEVERITY_VARIANT[signal.severity] ?? "grey"}>{signal.severity}</Badge>
      </td>
      <td className="py-2 pr-4">{SIGNAL_LABEL[signal.signal_type] ?? signal.signal_type}</td>
      <td className="py-2 pr-4 text-charcoal-ink/70">{note ?? "—"}</td>
      <td className="py-2 pr-4 text-right">
        {signal.amount_minor != null ? formatMinor(signal.amount_minor, signal.currency ?? "NGN") : "—"}
      </td>
      <td className="py-2 pr-4 text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onResolve(signal.id, "resolved")}>
            Resolve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onResolve(signal.id, "ignored")}>
            Ignore
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * §91.17 fraud detection review. payment_fraud_signals + its two RPCs
 * already existed live (a concurrent session built the schema) but nothing
 * ever wrote a signal into it until the fraud-sweep cron and the two
 * webhooks' dispute cases — see apps/web/src/lib/finance/fraud-sweep.ts.
 * Detection only: resolving/ignoring a signal here never takes an automated
 * account action, matching the reconciliation sweep's own posture.
 */
export function FraudSignals() {
  const qc = useQueryClient();
  const { data: signals, isLoading } = useFraudSignals("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function resolve(id: string, status: "resolved" | "ignored") {
    const res = await resolveFraudSignalAction(id, status);
    if (res.ok) {
      setMsg({ ok: true, text: status === "resolved" ? "Signal marked resolved." : "Signal ignored." });
      qc.invalidateQueries({ queryKey: financeKeys.all });
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not update the signal." });
    }
  }

  return (
    <SectionCard
      title="Fraud signals"
      description="Duplicate charges, unusual payment velocity, refund concentration, and disputes/chargebacks: detection only, nothing here takes automated action on an account."
    >
      {isLoading ? (
        <CenterNote>Loading…</CenterNote>
      ) : (signals ?? []).length === 0 ? (
        <CenterNote>No open signals. ✓</CenterNote>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
              <Th>Detected</Th>
              <Th>Severity</Th>
              <Th>Signal</Th>
              <Th>Detail</Th>
              <Th right>Amount</Th>
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
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}
    </SectionCard>
  );
}
