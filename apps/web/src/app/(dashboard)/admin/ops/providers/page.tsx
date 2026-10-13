import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { formatKobo } from "@/lib/format-money";
import { closeBreakAction, replayProviderEventAction } from "@/lib/providers/actions";
import { loadBreaks, loadInbox, loadProviderHealth } from "@/lib/providers/load";
import { BREAK_LABEL, INBOX_PROVIDERS, INBOX_STATUSES, canReplay, healthTone, inboxTone } from "@/lib/providers/model";

export const metadata = { title: "Payment, video and email providers" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";
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
  const [health, breaks, inbox] = await Promise.all([loadProviderHealth(), loadBreaks(breakStatus), loadInbox(provider, status)]);
  const result = sp.r && RESULT[sp.r] ? RESULT[sp.r] : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Payment, video and email providers" description="Whether each provider is answering, whether Paystack's settlements match our records, and every webhook we received." />
      {result && <p role="status" className="rounded-lg border border-charcoal-ink/20 px-4 py-3 text-sm">{result}</p>}

      <Card>
        <CardHeader><CardTitle>Provider health</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {health.failed ? <LoadFailure>Provider health could not be loaded. This is not the same as healthy.</LoadFailure>
            : health.rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">No calls recorded yet, or the circuit breaker is switched off.</p>
            : (
              <table className="w-full min-w-[640px]">
                <thead><tr>{["Provider", "Operation", "Status", "Failures in a row", "Last failure", "Last success", "Last error"].map((c) => <th key={c} className={head}>{c}</th>)}</tr></thead>
                <tbody>
                  {health.rows.map((r) => (
                    <tr key={`${r.provider}-${r.operation}`} className="border-t border-charcoal-ink/10">
                      <td className={cell}>{r.provider}</td>
                      <td className={cell}>{r.operation.replaceAll("_", " ")}</td>
                      <td className={cell}><Badge variant={healthTone(r.status)}>{r.status === "down" ? "Paused after repeated failures" : r.status === "degraded" ? "Some failures" : "Healthy"}</Badge></td>
                      <td className={cell}>{r.consecutive_failures}</td>
                      <td className={cell}>{lagos(r.last_failure_at)}</td>
                      <td className={cell}>{lagos(r.last_success_at)}</td>
                      <td className={cell}>{r.last_error_code ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement breaks</CardTitle>
          <p className="text-sm text-charcoal-ink/60">Where Paystack&apos;s settlement report and our ledger disagree. Nothing is corrected automatically: explain each one, with a note.</p>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <p className="text-sm"><a className="underline" href={`?breaks=${breakStatus ? "all" : "open"}`}>{breakStatus ? "Show closed breaks too" : "Show open breaks only"}</a></p>
          {breaks.failed ? <LoadFailure>The break queue could not be loaded. This is not the same as having none.</LoadFailure>
            : breaks.rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">No breaks.</p>
            : (
              <table className="w-full min-w-[820px]">
                <thead><tr>{["What", "Reference", "Paystack", "Our record", "Difference", "Age", "Close"].map((c) => <th key={c} className={head}>{c}</th>)}</tr></thead>
                <tbody>
                  {breaks.rows.map((b) => (
                    <tr key={b.id} className="border-t border-charcoal-ink/10">
                      <td className={cell}>{BREAK_LABEL[b.break_type]}{b.detail && <p className="text-xs text-charcoal-ink/60">{b.detail}</p>}</td>
                      <td className={cell}><code className="text-xs">{b.provider_reference}</code></td>
                      <td className={cell}>{b.provider_amount_kobo === null ? "-" : formatKobo(b.provider_amount_kobo)}</td>
                      <td className={cell}>{b.ledger_amount_kobo === null ? "-" : formatKobo(b.ledger_amount_kobo)}</td>
                      <td className={cell}>{b.difference_kobo === null ? "-" : formatKobo(b.difference_kobo)}</td>
                      <td className={cell}><Badge variant={b.age_hours >= 168 ? "red" : b.age_hours >= 72 ? "amber" : "grey"}>{b.age_hours}h</Badge></td>
                      <td className={cell}>
                        {b.status === "open" ? (
                          <form action={closeBreakAction} className="space-y-1">
                            <input type="hidden" name="break_id" value={b.id} />
                            <select name="status" className={field} defaultValue="explained"><option value="explained">Explained</option><option value="resolved">Resolved</option></select>
                            <input name="note" required minLength={10} maxLength={300} placeholder="What you found" className={field} />
                            <button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white">Close</button>
                          </form>
                        ) : <span className="text-xs text-charcoal-ink/60">{b.status}: {b.closing_note ?? ""}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Provider event inbox</CardTitle></CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
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
            : inbox.rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing received yet.</p>
            : (
              <table className="w-full min-w-[820px]">
                <thead><tr>{["Received", "Provider", "Event", "Status", "Deliveries", "Error", "Replay"].map((c) => <th key={c} className={head}>{c}</th>)}</tr></thead>
                <tbody>
                  {inbox.rows.map((e) => (
                    <tr key={e.id} className="border-t border-charcoal-ink/10">
                      <td className={cell}>{lagos(e.received_at)}</td>
                      <td className={cell}>{e.provider}</td>
                      <td className={cell}>{e.event_type}</td>
                      <td className={cell}><Badge variant={inboxTone(e.status)}>{e.status === "rejected" ? "Signature failed" : e.status}</Badge></td>
                      <td className={cell}>{e.delivery_count}{e.replay_count > 0 ? ` (replayed ${e.replay_count})` : ""}</td>
                      <td className={cell}>{e.last_error ?? "-"}</td>
                      <td className={cell}>
                        {canReplay(e) ? (
                          <form action={replayProviderEventAction} className="space-y-1">
                            <input type="hidden" name="event_id" value={e.id} />
                            <input name="reason" required minLength={10} maxLength={300} placeholder="Why replay it" className={field} />
                            <button type="submit" className="rounded-lg border border-charcoal-ink/30 px-3 py-1.5 text-sm">Replay</button>
                          </form>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
