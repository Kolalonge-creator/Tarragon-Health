import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
import { formatKobo } from "@/lib/format-money";
import { closeBreakAction, replayProviderEventAction } from "@/lib/providers/actions";
import { loadBreaks, loadGlAttention, loadInbox, loadProviderHealth } from "@/lib/providers/load";
import { BREAK_LABEL, INBOX_PROVIDERS, INBOX_STATUSES, canReplay, healthTone, inboxTone } from "@/lib/providers/model";

export const metadata = { title: "Payment, video and email providers" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
const RESULT: Record<string, string> = {
  ok: "Done.",
  failed: "That did not work. Nothing was changed.",
  busy: "That event is being handled right now. Try again in a minute.",
  invalid: "Please fill in every field. A reason or note needs at least ten characters.",
};

/**
 * S14x: the provider layer board. Provider health (the circuit breaker), the settlement reconciliation break queue with ageing, and
 * the provider event inbox with audited replay. Admin only. Closing a break and replaying an event are both audited; nothing on this
 * page posts to the ledger, sends money or contacts a patient. The raw webhook body is never shown here.
 */
export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ provider?: string; status?: string; breaks?: string; r?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const sp = await searchParams;
  const provider = INBOX_PROVIDERS.find((p) => p === sp.provider) ?? null;
  const status = INBOX_STATUSES.find((s) => s === sp.status) ?? null;
  const breakStatus = sp.breaks === "all" ? null : "open";
  const [health, breaks, inbox, glAttention] = await Promise.all([loadProviderHealth(), loadBreaks(breakStatus), loadInbox(provider, status), loadGlAttention()]);
  const result = sp.r && RESULT[sp.r] ? RESULT[sp.r] : null;
  const kobo = (v: number | null) => (v === null ? "-" : formatKobo(v));
  const cols = (specs: [string, Partial<DataTableColumn>?][]): DataTableColumn[] => specs.map(([header, rest]) => ({ header, ...rest }));

  // Down first when sorted by status: the provider that needs looking at.
  const HEALTH_ORDER: Record<string, number> = { down: 0, degraded: 1 };
  const healthColumns = cols([
    ["Provider", { sortable: true }],
    ["Operation", { sortable: true }],
    ["Status", { sortable: true }],
    ["Failures in a row", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Last failure", { sortable: true, defaultDir: "desc" }],
    ["Last success", { sortable: true, defaultDir: "desc" }],
    ["Last error"],
  ]);
  const healthRows: DataTableRow[] = health.rows.map((r) => ({
    key: `${r.provider}-${r.operation}`,
    searchText: `${r.provider} ${r.operation.replaceAll("_", " ")} ${r.last_error_code ?? ""}`,
    sort: [r.provider, r.operation, HEALTH_ORDER[r.status] ?? 2, r.consecutive_failures, r.last_failure_at, r.last_success_at, null],
    cells: [
      r.provider,
      r.operation.replaceAll("_", " "),
      <Badge key="s" variant={healthTone(r.status)}>{r.status === "down" ? "Paused after repeated failures" : r.status === "degraded" ? "Some failures" : "Healthy"}</Badge>,
      r.consecutive_failures,
      lagos(r.last_failure_at),
      lagos(r.last_success_at),
      r.last_error_code ?? "-",
    ],
  }));

  const breakColumns = cols([
    ["What", { sortable: true }],
    ["Reference", { sortable: true }],
    ["Paystack", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Our record", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Difference", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Age", { sortable: true, defaultDir: "desc" }],
    ["Close", { className: "min-w-56" }],
  ]);
  const breakRows: DataTableRow[] = breaks.rows.map((b) => ({
    key: b.id,
    searchText: `${BREAK_LABEL[b.break_type]} ${b.detail ?? ""} ${b.provider_reference}`,
    // Difference sorts by size, whichever side is short.
    sort: [BREAK_LABEL[b.break_type], b.provider_reference, b.provider_amount_kobo, b.ledger_amount_kobo, b.difference_kobo === null ? null : Math.abs(b.difference_kobo), b.age_hours, null],
    cells: [
      <span key="what">{BREAK_LABEL[b.break_type]}{b.detail && <span className="block text-xs text-charcoal-ink/60">{b.detail}</span>}</span>,
      <code key="ref" className="text-xs">{b.provider_reference}</code>,
      kobo(b.provider_amount_kobo),
      kobo(b.ledger_amount_kobo),
      kobo(b.difference_kobo),
      <Badge key="age" variant={b.age_hours >= 168 ? "red" : b.age_hours >= 72 ? "amber" : "grey"}>{b.age_hours}h</Badge>,
      b.status === "open" ? (
        <form key="close" action={closeBreakAction} className="space-y-1">
          <input type="hidden" name="break_id" value={b.id} />
          <select name="status" aria-label="How it was closed" className={field} defaultValue="explained"><option value="explained">Explained</option><option value="resolved">Resolved</option></select>
          <input name="note" aria-label="What you found" required minLength={10} maxLength={300} placeholder="What you found" className={field} />
          <button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white">Close</button>
        </form>
      ) : <span key="closed" className="text-xs text-charcoal-ink/60">{b.status}: {b.closing_note ?? ""}</span>,
    ],
  }));

  const glColumns = cols([
    ["Payout", { sortable: true }],
    ["Attempt", { sortable: true, align: "right" }],
    ["What", { sortable: true }],
    ["Status", { sortable: true }],
    ["Amount", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Why"],
  ]);
  const glRows: DataTableRow[] = glAttention.rows.map((r) => ({
    key: `${r.payout_id}-${r.attempt}-${r.kind}`,
    searchText: `${r.payout_id} ${r.kind} ${r.status} ${r.error ?? ""}`,
    sort: [r.payout_id, r.attempt, r.kind, r.status === "failed" ? 0 : 1, r.amount_kobo, null],
    cells: [
      <code key="id" className="text-xs">{r.payout_id.slice(0, 8)}</code>,
      r.attempt,
      r.kind === "sent" ? "Payout sent" : "Payout returned by the bank",
      <Badge key="s" variant={r.status === "failed" ? "red" : "grey"}>{r.status}</Badge>,
      formatKobo(r.amount_kobo),
      r.error ?? "-",
    ],
  }));

  const inboxColumns = cols([
    ["Received", { sortable: true, defaultDir: "desc" }],
    ["Provider", { sortable: true }],
    ["Event", { sortable: true }],
    ["Status", { sortable: true }],
    ["Deliveries", { sortable: true, defaultDir: "desc", align: "right" }],
    ["Error"],
    ["Replay", { className: "min-w-48" }],
  ]);
  const inboxRows: DataTableRow[] = inbox.rows.map((e) => ({
    key: e.id,
    searchText: `${e.provider} ${e.event_type} ${e.status} ${e.last_error ?? ""}`,
    sort: [e.received_at, e.provider, e.event_type, e.status, e.delivery_count, null, null],
    cells: [
      lagos(e.received_at),
      e.provider,
      e.event_type,
      <Badge key="s" variant={inboxTone(e.status)}>{e.status === "rejected" ? "Signature failed" : e.status}</Badge>,
      `${e.delivery_count}${e.replay_count > 0 ? ` (replayed ${e.replay_count})` : ""}`,
      e.last_error ?? "-",
      canReplay(e) ? (
        <form key="replay" action={replayProviderEventAction} className="space-y-1">
          <input type="hidden" name="event_id" value={e.id} />
          <input name="reason" aria-label="Why replay it" required minLength={10} maxLength={300} placeholder="Why replay it" className={field} />
          <button type="submit" className="rounded-lg border border-charcoal-ink/30 px-3 py-1.5 text-sm">Replay</button>
        </form>
      ) : "-",
    ],
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Payment, video and email providers" description="Whether each provider is answering, whether Paystack's settlements match our records, and every webhook we received." />
      {result && <p role="status" className="rounded-lg border border-charcoal-ink/20 px-4 py-3 text-sm">{result}</p>}

      <Card>
        <CardHeader><CardTitle>Provider health</CardTitle></CardHeader>
        <CardContent>
          {health.failed ? <LoadFailure>Provider health could not be loaded. This is not the same as healthy.</LoadFailure>
            : <DataTable caption="Provider health" columns={healthColumns} rows={healthRows} searchLabel="Search providers" emptyMessage="No calls recorded yet, or the circuit breaker is switched off." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement breaks</CardTitle>
          <p className="text-sm text-charcoal-ink/60">Where Paystack&apos;s settlement report and our ledger disagree. Nothing is corrected automatically: explain each one, with a note.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm"><a className="underline" href={`?breaks=${breakStatus ? "all" : "open"}`}>{breakStatus ? "Show closed breaks too" : "Show open breaks only"}</a></p>
          {breaks.failed ? <LoadFailure>The break queue could not be loaded. This is not the same as having none.</LoadFailure>
            : <DataTable caption="Settlement breaks" columns={breakColumns} rows={breakRows} searchLabel="Search breaks" emptyMessage="No breaks." noun={{ one: "break", many: "breaks" }} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payout ledger postings that need finance</CardTitle>
          <p className="text-sm text-charcoal-ink/60">A payout posting that failed (for example the accounting period was closed) or was skipped because the bank returned the money first. Reopen the period and retry, or leave the skipped ones as they are.</p>
        </CardHeader>
        <CardContent>
          {glAttention.failed ? <LoadFailure>This list could not be loaded. This is not the same as having none.</LoadFailure>
            : <DataTable caption="Payout ledger postings that need finance" columns={glColumns} rows={glRows} emptyMessage="Nothing needs attention." noun={{ one: "posting", many: "postings" }} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Provider event inbox</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Provider
              <select name="provider" defaultValue={provider ?? ""} className={field}><option value="">Any</option>{INBOX_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </label>
            <label className="text-sm">Status
              <select name="status" defaultValue={status ?? ""} className={field}><option value="">Any</option>{INBOX_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <div className="flex items-end"><button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">Apply</button></div>
          </form>
          {inbox.failed ? <LoadFailure>The inbox could not be loaded.</LoadFailure>
            : <DataTable caption="Provider event inbox" columns={inboxColumns} rows={inboxRows} searchLabel="Search events" initialSort={{ column: 0, dir: "desc" }} emptyMessage="Nothing received yet." noun={{ one: "event", many: "events" }} />}
        </CardContent>
      </Card>
    </div>
  );
}
