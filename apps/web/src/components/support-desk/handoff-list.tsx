"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHandoffAction, useSupportHandoffs, type SupportHandoff } from "@/lib/queries/support-desk";
import { HANDOFF_DESTINATION_LABEL, SOURCE_LABEL, type WorkSource } from "@/lib/support-desk/model";

const STATUS: Record<string, { label: string; variant: "amber" | "blue" | "green" | "grey" }> = {
  open: { label: "Waiting for the team", variant: "amber" },
  acknowledged: { label: "Taken", variant: "blue" },
  outcome_recorded: { label: "Outcome recorded", variant: "green" },
  withdrawn: { label: "Withdrawn", variant: "grey" },
};

const reference = (h: SupportHandoff) =>
  `${{ support_ticket: "TK", help_request: "HR", care_thread: "MS", complaint: "CP" }[h.source] ?? "SU"}-${h.source_id.slice(0, 8).toUpperCase()}`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const field = "w-full rounded-md border border-charcoal-ink/15 bg-white px-2 py-1.5 text-sm dark:border-night-ink/20 dark:bg-transparent";

function OutcomeForm({ h, onDone }: { h: SupportHandoff; onDone: () => void }) {
  const act = useHandoffAction();
  const [outcome, setOutcome] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [refundId, setRefundId] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uuid = /^[0-9a-f-]{36}$/i;
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if ((refundId && !uuid.test(refundId)) || (incidentId && !uuid.test(incidentId))) {
          setError("A refund or incident reference must be its full ID.");
          return;
        }
        try {
          await act.mutateAsync({ kind: "outcome", id: h.id, outcome, customerMessage, refundId: refundId || null, incidentId: incidentId || null });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save.");
        }
      }}
    >
      <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        What was decided (for the record)
        <textarea required minLength={10} rows={3} className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </label>
      <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        What support may tell the customer (optional; no clinical detail)
        <textarea rows={2} className={field} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} />
      </label>
      {h.destination === "finance" && (
        <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Refund ID, if a refund was made in the finance console (optional)
          <input className={field} value={refundId} onChange={(e) => setRefundId(e.target.value.trim())} />
        </label>
      )}
      {h.destination === "technical_ops" && (
        <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Incident ID, if this is part of a platform incident (optional)
          <input className={field} value={incidentId} onChange={(e) => setIncidentId(e.target.value.trim())} />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="submit" size="sm" disabled={act.isPending || outcome.trim().length < 10}>
        Record outcome
      </Button>
    </form>
  );
}

/**
 * Support hand-offs (SUP-2). mode "support": what the desk has handed to other teams, with withdraw for an untaken one.
 * mode "receiving": what the caller's team has been asked to decide, with take ownership and record outcome. RLS limits
 * each reader to their own side.
 */
export function HandoffList({ mode, me, isLead }: { mode: "support" | "receiving"; me: string; isLead?: boolean }) {
  const list = useSupportHandoffs(mode === "receiving" ? "inbox" : "all");
  const act = useHandoffAction();
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = list.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "receiving" ? "Asked of your team" : "Handed to other teams"}</CardTitle>
        <CardDescription>
          {mode === "receiving"
            ? "Support found the problem; your team decides. Take ownership, decide in your own console, then record the outcome and what support may tell the customer."
            : "Finance, Technical Operations, Provider Operations, Membership Operations and senior management. Clinical concerns never go here: they use the clinical route."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {list.isError && <p role="alert" className="text-sm text-red-700">Hand-offs could not be loaded.</p>}
        {list.data && rows.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing here.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {rows.map((h) => {
          const st = STATUS[h.status] ?? { label: h.status, variant: "grey" as const };
          return (
            <div key={h.id} className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {reference(h)} · {SOURCE_LABEL[h.source as WorkSource] ?? h.source} · to {HANDOFF_DESTINATION_LABEL[h.destination] ?? h.destination}
                </p>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              <p className="mt-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">{h.reason}</p>
              <p className="mt-1 text-xs text-charcoal-ink/55 dark:text-night-ink/55">Raised {when(h.raised_at)}{h.acknowledged_at ? ` · taken ${when(h.acknowledged_at)}` : ""}</p>
              {h.status === "outcome_recorded" && (
                <div className="mt-2 rounded-md bg-soft-sage/60 p-2 text-sm dark:bg-brand-green/10">
                  <p><span className="font-medium">Outcome:</span> {h.outcome}</p>
                  {h.customer_message && <p className="mt-1"><span className="font-medium">For the customer:</span> {h.customer_message}</p>}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {mode === "receiving" && h.status === "open" && (
                  <Button type="button" size="sm" variant="outline" disabled={act.isPending}
                    onClick={() => act.mutateAsync({ kind: "acknowledge", id: h.id }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not take ownership."))}>
                    Take ownership
                  </Button>
                )}
                {mode === "receiving" && (h.status === "open" || h.status === "acknowledged") && (
                  <Button type="button" size="sm" onClick={() => setOpenForm(openForm === h.id ? null : h.id)}>
                    {openForm === h.id ? "Cancel" : "Record outcome"}
                  </Button>
                )}
                {mode === "support" && h.status === "open" && (isLead || h.raised_by === me) && (
                  <Button type="button" size="sm" variant="ghost" disabled={act.isPending}
                    onClick={() => {
                      const reason = window.prompt("Why is this being withdrawn? (at least 10 characters)");
                      if (reason) act.mutateAsync({ kind: "withdraw", id: h.id, reason }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not withdraw."));
                    }}>
                    Withdraw
                  </Button>
                )}
              </div>
              {openForm === h.id && <OutcomeForm h={h} onDone={() => setOpenForm(null)} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
