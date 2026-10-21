import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import { KIND_LABEL } from "@/lib/earnings/earnings";
import { HOLD_REASON_WORDS, REASON_CODES, REASON_LABEL, adminDisputeRowsSchema, topupHoldRowsSchema, type ReasonCode } from "@/lib/earnings/disputes";
import { ResolveDisputeForm, TopupHoldForm } from "./dispute-forms";

const dateTime = (value: string): string => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

function Problem({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="text-sm text-red-600">{children}</p>;
}

const reasonText = (code: string): string => ((REASON_CODES as readonly string[]).includes(code) ? REASON_LABEL[code as ReasonCode] : code);

/**
 * Finance's side of earnings questions (S30b): the open disputes with their response clock, and the pilot-minimum top-ups that the
 * activity check held for a person. Admin accounts only; the database checks the role again on every call. A failed load says so and is
 * never shown as an empty list.
 */
export async function AdminDisputesView() {
  const supabase = await createClient();
  const [open, recent, holds] = await Promise.all([
    supabase.rpc("list_earnings_disputes", { p_state: "open" }),
    supabase.rpc("list_earnings_disputes", { p_state: "all" }),
    supabase.rpc("list_topup_holds", { p_state: "held" }),
  ]);
  const openRows = open.error ? null : adminDisputeRowsSchema.safeParse(open.data);
  const allRows = recent.error ? null : adminDisputeRowsSchema.safeParse(recent.data);
  const holdRows = holds.error ? null : topupHoldRowsSchema.safeParse(holds.data);
  const answered = allRows?.success ? allRows.data.filter((r) => r.state !== "open").slice(0, 25) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Earnings questions</h1>
        <p className="text-sm text-charcoal-ink/60">
          A clinician can question one line of their statement. That line is held out of their next payout while the rest pays. Answer with a correction line
          or turn it down with a reason; either way the line is released. <Link href="/admin/earnings" className="underline">Back to fees and earnings</Link>.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Open questions</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!openRows?.success ? (
            <Problem>The questions could not be loaded. This is not the same as there being none.</Problem>
          ) : openRows.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing open.</p>
          ) : (
            openRows.data.map((d) => (
              <div key={d.id} className="space-y-2 border-b border-charcoal-ink/10 pb-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{d.clinician_name ?? "A clinician"}</span>
                  <span>
                    {d.overdue ? <Badge variant="red">Answer overdue</Badge> : <Badge variant="amber">Answer by {dateTime(d.response_due_at)}</Badge>}
                  </span>
                </div>
                <p className="text-charcoal-ink/70">
                  {KIND_LABEL[d.line_kind] ?? d.line_kind}
                  {d.task_type ? ` (${d.task_type.replaceAll("_", " ")})` : ""}, {dateTime(d.line_earned_at)}, {formatKobo(d.line_amount_kobo)}. Reason: {reasonText(d.reason_code)}.
                </p>
                {d.note && <p className="text-charcoal-ink/70">Their note: {d.note}</p>}
                <ResolveDisputeForm disputeId={d.id} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pilot minimum top-ups held for a person</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-charcoal-ink/60">
            The activity check holds a top-up when the declared hours show no sign of work. A held top-up is not paid and not dropped: release it or deny it, with a reason.
          </p>
          {!holdRows?.success ? (
            <Problem>The held top-ups could not be loaded. This is not the same as there being none.</Problem>
          ) : holdRows.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing is held.</p>
          ) : (
            holdRows.data.map((h) => (
              <div key={h.id} className="space-y-2 border-b border-charcoal-ink/10 pb-4 text-sm">
                <p className="font-medium">{h.clinician_name ?? "A clinician"}, {dateTime(h.run_start)} to {dateTime(h.run_end)}</p>
                <p className="text-charcoal-ink/70">
                  {HOLD_REASON_WORDS[h.reason] ?? "Held for a person to check."} Tasks taken: {String(h.evidence.claims ?? 0)}, finished: {String(h.evidence.completed_claims ?? 0)}, timed out:{" "}
                  {String(h.evidence.expired_claims ?? 0)}, tasks waiting: {String(h.evidence.tasks_waiting ?? 0)}.
                  {typeof h.evidence.top_up_kobo === "number" ? ` Top-up at stake: ${formatKobo(h.evidence.top_up_kobo)}.` : ""}
                </p>
                <TopupHoldForm holdId={h.id} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recently answered</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!allRows?.success ? (
            <Problem>The list could not be loaded.</Problem>
          ) : answered.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing answered yet.</p>
          ) : (
            answered.map((d) => (
              <div key={d.id} className="border-b border-charcoal-ink/10 py-2 text-sm">
                <p>
                  {d.clinician_name ?? "A clinician"}: {KIND_LABEL[d.line_kind] ?? d.line_kind}, {formatKobo(d.line_amount_kobo)}.{" "}
                  <Badge variant={d.state === "adjusted" ? "green" : "grey"}>{d.state === "adjusted" ? "Correction added" : d.state === "rejected" ? "Turned down" : "Withdrawn"}</Badge>
                </p>
                {d.resolution_note && <p className="text-charcoal-ink/70">{d.resolution_note}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
