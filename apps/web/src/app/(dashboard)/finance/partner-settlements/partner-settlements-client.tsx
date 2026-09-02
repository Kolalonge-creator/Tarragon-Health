"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { koboToNaira } from "@tarragon/shared";
import {
  createPartnerStatement,
  matchStatementAction,
  approveStatementAction,
  type PartnerSettlementActionState,
} from "./actions";
import { SectionCard, CenterNote, TableShell, Th } from "../_components/primitives";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const STATUS_VARIANT: Record<string, "green" | "grey" | "amber" | "red"> = {
  draft: "grey",
  matched: "green",
  disputed: "amber",
  approved: "green",
  settled: "green",
};

export type PartnerOption = { id: string; name: string };

export type StatementRow = {
  id: string;
  reference: string;
  provider_name: string | null;
  period_start: string;
  period_end: string;
  invoiced_total_kobo: number;
  expected_total_kobo: number | null;
  status: string;
  currency: string;
};

function CreateStatementForm({ providers }: { providers: PartnerOption[] }) {
  const [state, action, pending] = useActionState<PartnerSettlementActionState, FormData>(
    createPartnerStatement,
    undefined,
  );

  return (
    <SectionCard
      title="Record a new laboratory invoice"
      description="Enter exactly what the laboratory invoiced for a period. Matching it against our own orders is the next step, not this one."
    >
      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ps-provider">Laboratory</Label>
            <Select id="ps-provider" name="providerId" defaultValue="" required>
              <option value="">Choose a laboratory</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ps-reference">Their invoice/reference number</Label>
            <Input id="ps-reference" name="reference" placeholder="SYN-2026-08-0113" required />
          </div>
          <div>
            <Label htmlFor="ps-period-start">Period start</Label>
            <Input id="ps-period-start" name="periodStart" type="date" required />
          </div>
          <div>
            <Label htmlFor="ps-period-end">Period end</Label>
            <Input id="ps-period-end" name="periodEnd" type="date" required />
          </div>
          <div>
            <Label htmlFor="ps-total">Total invoiced (₦)</Label>
            <Input id="ps-total" name="invoicedTotalNaira" type="number" step="0.01" min="0" required />
          </div>
        </div>

        <div>
          <Label htmlFor="ps-lines">Line items (optional, one per line)</Label>
          <Textarea
            id="ps-lines"
            name="lines"
            rows={4}
            placeholder={"screen_type_code,invoiced_naira,lab_order_id (optional),their_reference (optional)\nFBC,3500,,\nLIPID_PANEL,8000,,"}
          />
          <p className="mt-1 text-xs text-charcoal-ink/50">
            Leave blank to save just the total for now — lines can be reconciled line-by-line once
            entered, but matching works from these rows, so add them when you have the detail.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save statement"}
          </Button>
          {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state?.message && <span className="text-sm text-deep-forest">{state.message}</span>}
        </div>
      </form>
    </SectionCard>
  );
}

function StatementActions({ statement }: { statement: StatementRow }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<PartnerSettlementActionState>(undefined);
  const [showApprove, setShowApprove] = useState(false);

  if (statement.status === "settled" || statement.status === "approved") {
    return <span className="text-xs text-charcoal-ink/50">No further action needed.</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {(statement.status === "draft" || statement.status === "disputed") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setFeedback(await matchStatementAction(statement.id)))
            }
          >
            {pending ? "Matching…" : "Match against our orders"}
          </Button>
        )}
        {(statement.status === "matched" || statement.status === "disputed") && (
          <Button type="button" size="sm" disabled={pending} onClick={() => setShowApprove((s) => !s)}>
            Approve
          </Button>
        )}
      </div>
      {showApprove && (
        <div className="flex items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={statement.status === "disputed" ? "Reason for approving despite a variance (required)" : "Optional note"}
            className="w-64"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveStatementAction(statement.id, note);
                setFeedback(result);
                if (!result?.error) setShowApprove(false);
              })
            }
          >
            {pending ? "Approving…" : "Confirm approval"}
          </Button>
        </div>
      )}
      {feedback?.error && <span className="text-xs text-clinical-red">{feedback.error}</span>}
      {feedback?.message && <span className="text-xs text-deep-forest">{feedback.message}</span>}
    </div>
  );
}

export function PartnerSettlementsClient({
  providers,
  statements,
}: {
  providers: PartnerOption[];
  statements: StatementRow[];
}) {
  return (
    <div className="space-y-6">
      <CreateStatementForm providers={providers} />

      <SectionCard
        title="Statements"
        description="Amounts payable to the laboratory — from Tarragon's side, this is what we owe them, not the reverse."
      >
        {statements.length === 0 ? (
          <CenterNote>No laboratory statements recorded yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10">
                <Th>Laboratory</Th>
                <Th>Reference</Th>
                <Th>Period</Th>
                <Th right>Invoiced</Th>
                <Th right>Expected (ours)</Th>
                <Th>Status</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4">{s.provider_name ?? "—"}</td>
                  <td className="py-2 pr-4">{s.reference}</td>
                  <td className="py-2 pr-4">
                    {new Date(s.period_start).toLocaleDateString("en-NG")} –{" "}
                    {new Date(s.period_end).toLocaleDateString("en-NG")}
                  </td>
                  <td className="py-2 pr-4 text-right">{naira(s.invoiced_total_kobo)}</td>
                  <td className="py-2 pr-4 text-right">
                    {s.expected_total_kobo === null ? "—" : naira(s.expected_total_kobo)}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={STATUS_VARIANT[s.status] ?? "grey"}>{s.status}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <StatementActions statement={s} />
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
