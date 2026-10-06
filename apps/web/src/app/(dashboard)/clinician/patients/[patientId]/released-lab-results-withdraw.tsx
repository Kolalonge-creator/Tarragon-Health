"use client";

import { useActionState, useState, useTransition } from "react";
import { listReleasedLabResults, withdrawResult } from "@/lib/lab-results/structured-actions";
import type { ReleasedResultRow } from "@/lib/lab-results/structured";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TOUCH = "min-h-11";

function WithdrawForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(withdrawResult, undefined);
  if (state?.success) return <p role="status" className="text-sm text-green-800">Withdrawn. The patient has a neutral notice.</p>;
  if (!open) {
    return (
      <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(true)}>
        Withdraw
      </Button>
    );
  }
  return (
    <form action={action} className="w-full space-y-2">
      <input type="hidden" name="result_id" value={id} />
      <Label htmlFor={`wd-${id}`}>Why is this being withdrawn?</Label>
      <Textarea id={`wd-${id}`} name="reason" rows={2} maxLength={500} required />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>Withdraw this result</Button>
    </form>
  );
}

/**
 * For a senior clinician tied to the patient: released lab results, with a way to withdraw one that was wrong (wrong patient, lab
 * error). Nothing is listed until the clinician asks, and asking is one audited read. Withdrawing hides it from the patient and
 * sends a neutral notice.
 */
export function ReleasedLabResultsWithdraw({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<ReleasedResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Released lab results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows === null ? (
          <>
            <p className="text-sm text-charcoal-ink/70">Use this only to withdraw a result that was released by mistake. Opening the list is recorded in the audit log.</p>
            <Button
              type="button"
              variant="outline"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await listReleasedLabResults(patientId);
                  setRows(r.results ?? null);
                  setError(r.error ?? null);
                })
              }
            >
              Show released results
            </Button>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          </>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No lab results have been released for this patient.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.lab_result_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {r.panel_code ? r.panel_code.replace(/_/g, " ") : "Report only"}
                    {r.order_number ? ` · order ${r.order_number}` : ""}
                  </p>
                  <p className="text-charcoal-ink/60">
                    Released {r.released_at ? new Date(r.released_at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" }) : "earlier"} · {r.item_count} values, {r.abnormal_count} outside range
                  </p>
                </div>
                {r.withdrawn ? <Badge variant="grey">Withdrawn</Badge> : r.replaced ? <Badge variant="grey">Replaced</Badge> : <WithdrawForm id={r.lab_result_id} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
