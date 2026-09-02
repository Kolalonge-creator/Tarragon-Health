"use client";

import { useActionState } from "react";
import { attestBoardReportAction, withdrawBoardReportAction } from "../actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BoardReportRow } from "@/lib/payer/board-report";

/**
 * Tarragon's side of the document: attest it, or withdraw it.
 *
 * Rendered only for a Tarragon superadmin (the page decides), and refused by
 * the database for anybody else — including the payer the report is about.
 * Tarragon produces these figures, so Tarragon is the party that signs them;
 * a payer attesting its own supplier's numbers would mean nothing to that
 * payer's board.
 *
 * Never shown for a report that is already attested: an attestation is a
 * signature, and the database will not let one be altered or repeated.
 */
export function SignOffPanel({ report }: { report: BoardReportRow }) {
  const [attestState, attestAction, attesting] = useActionState(attestBoardReportAction, undefined);
  const [withdrawState, withdrawAction, withdrawing] = useActionState(
    withdrawBoardReportAction,
    undefined
  );

  const canAttest = report.status === "draft";
  const canWithdraw = report.status !== "withdrawn";

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>TarragonHealth sign-off</CardTitle>
        <CardDescription>
          Visible to Tarragon staff only. The figures above are already frozen — attesting records
          who stands behind them, after re-checking that the stored figures still match the
          document&apos;s verification code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canAttest ? (
          <form action={attestAction} className="space-y-3">
            <input type="hidden" name="reportId" value={report.id} />
            <div className="space-y-1.5">
              <Label htmlFor="roleTitle">Signatory role</Label>
              <Input
                id="roleTitle"
                name="roleTitle"
                placeholder="Clinical Director"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="statement">What you are attesting to</Label>
              <Textarea
                id="statement"
                name="statement"
                rows={3}
                required
                minLength={20}
                defaultValue="I confirm these figures were produced from the platform record for the stated period using the stated measure definitions, and that the limitations section fairly describes what they do not show."
              />
            </div>
            <Button type="submit" disabled={attesting}>
              {attesting ? "Attesting…" : "Attest this report"}
            </Button>
            {attestState?.error && <p className="text-sm text-red-700">{attestState.error}</p>}
            {attestState?.message && <p className="text-sm text-brand-green">{attestState.message}</p>}
          </form>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            {report.status === "attested"
              ? "This report is attested. An attestation cannot be altered or repeated — withdraw the report and issue a fresh one if something is wrong."
              : `This report is ${report.status} and cannot be attested.`}
          </p>
        )}

        {canWithdraw && (
          <form action={withdrawAction} className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <input type="hidden" name="reportId" value={report.id} />
            <div className="space-y-1.5">
              <Label htmlFor="reason">Withdraw this report — reason</Label>
              <Textarea
                id="reason"
                name="reason"
                rows={2}
                required
                minLength={10}
                placeholder="Anyone verifying a printed copy will be shown this reason."
              />
            </div>
            <Button type="submit" variant="outline" disabled={withdrawing}>
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </Button>
            <p className="text-xs text-charcoal-ink/60">
              Withdrawal is permanent and cannot be reversed. The report stays readable and still
              verifies, so copies already in circulation are shown as withdrawn rather than becoming
              unverifiable.
            </p>
            {withdrawState?.error && <p className="text-sm text-red-700">{withdrawState.error}</p>}
            {withdrawState?.message && (
              <p className="text-sm text-brand-green">{withdrawState.message}</p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
