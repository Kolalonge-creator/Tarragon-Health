"use client";

import { useActionState } from "react";
import { signLabPanels } from "./actions";
import type { PanelDefinition } from "@/lib/lab-results/structured";
import { describeSexRanges, PANEL_LABEL, type PanelCode } from "@/lib/lab-results/structured";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LabSignoffRow = { id: string; version: number; approved_at: string | null; created_at: string; config: unknown };

const TOUCH = "min-h-11";

function num(v: number | undefined): string {
  return v === undefined ? "" : String(v);
}

export function LabPanelsView({ signoff, panels, canSign }: { signoff: LabSignoffRow | null; panels: PanelDefinition[]; canSign: boolean }) {
  const [state, action, pending] = useActionState(signLabPanels, undefined);
  const signed = signoff?.approved_at != null;
  const cfg = (signoff?.config ?? {}) as { disclosure?: { maxAttempts?: number; escalateAfterHours?: number } };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(signoff!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "All-normal results can release on their own."
            : "Until these are signed, no lab result releases on its own: every result is held for a clinician to review."}
        </p>
      </div>

      {panels.map((p) => (
        <Card key={p.panel_code}>
          <CardHeader>
            <CardTitle className="text-base">{PANEL_LABEL[p.panel_code as PanelCode] ?? p.panel_code} (version {p.version})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">Ranges and limits for {p.panel_code}</caption>
              <thead>
                <tr className="text-left text-charcoal-ink/60">
                  <th scope="col" className="py-1">Test</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Low</th>
                  <th scope="col">High</th>
                  <th scope="col">Critical low</th>
                  <th scope="col">Critical high</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {p.analytes.map((a) => (
                  <tr key={a.code} className="border-t">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">{a.label}</th>
                    <td>{a.unit}</td>
                    <td>{num(a.refLow)}</td>
                    <td>{num(a.refHigh)}</td>
                    <td>{num(a.criticalLow)}</td>
                    <td>{num(a.criticalHigh)}</td>
                    <td>{[a.kind === "qualitative" ? "positive or negative" : "", describeSexRanges(a), a.sensitive ? "sensitive: disclosed in person" : "", a.optional ? "only if ordered" : ""].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Held sensitive results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>After {cfg.disclosure?.maxAttempts ?? 3} unsuccessful attempts to reach the patient, or {cfg.disclosure?.escalateAfterHours ?? 72} hours without a disclosure, the CMO is told. A sensitive result is never released by default.</p>
        </CardContent>
      </Card>

      {canSign && signoff && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={signoff.id} />
          <p className="text-sm text-charcoal-ink/70">
            These values are proposals written by the build team, not clinical advice. Signing records that you reviewed every range, critical limit and the disclosure policy above, under your own name.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed every range and critical limit and the disclosure policy.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the lab ranges</Button>
        </form>
      ) : null}
    </div>
  );
}
