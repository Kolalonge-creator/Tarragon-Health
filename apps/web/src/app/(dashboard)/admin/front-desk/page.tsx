import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { buildTiles, fmtDay, REASON_LABEL, topicLabel, type Dashboard, type Tone } from "@/lib/frontdesk/dashboard-model";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { AssistantSwitch, ReportNow, SampleShare } from "./front-desk-controls";

export const metadata = { title: "Front desk" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" }) : "not yet");

export default async function FrontDeskPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // The dashboard reads conversation counts and reports; the database allows only an admin (private.fd_require_admin).
  const { isSuperAdmin } = await getCallerPermissions();
  if (!isSuperAdmin) redirect("/admin");

  const { data, error } = await fdRpcData<Dashboard>(await createClient(), "fd_dashboard");
  const d = data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Front desk"
        description="The website chat, follow-up emails and the weekly report in one place. Numbers are the last 7 days against the 7 before."
      />
      {error || !d ? (
        <LoadFailure>The front desk numbers could not be loaded. This is not a report that nothing is happening. Reload to try again.</LoadFailure>
      ) : (
        <>
          <section aria-label="Kill switch" className="space-y-3 rounded-xl border border-charcoal-ink/15 bg-white p-5 dark:border-night-ink/20 dark:bg-night-card">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-heading text-xl font-semibold">The assistant</h2>
              <Badge variant={d.current.switches?.assistant_enabled === true ? "green" : "red"}>{d.current.switches?.assistant_enabled === true ? "On" : "Off: visitors see the contact form"}</Badge>
              {d.current.switches?.prelaunch_mode === true && <Badge variant="amber">Pre-launch wording</Badge>}
            </div>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Off sends every visitor to the contact form and stores nothing from the assistant. Emergency wording is still answered with the fixed message. Nothing is lost: turn it on and it carries on.
            </p>
            <AssistantSwitch enabled={d.current.switches?.assistant_enabled === true} />
          </section>

          <section aria-label="Numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {buildTiles(d).map((t) => <Tile key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} />)}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-label="Topics" className="space-y-2">
              <h2 className="font-heading text-xl font-semibold">What people ask about</h2>
              <CountList items={d.current.topics ?? []} empty="No chats yet this week." />
              <h3 className="pt-2 text-sm font-semibold">Questions the assistant could not answer</h3>
              <CountList items={d.current.unanswered ?? []} empty="None. Every question had an approved answer." />
            </section>
            <section aria-label="Handoffs" className="space-y-2">
              <h2 className="font-heading text-xl font-semibold">Why people were handed to you</h2>
              {Object.keys(d.current.handoffs?.by_reason ?? {}).length === 0 ? (
                <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">No handoffs this week.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {Object.entries(d.current.handoffs?.by_reason ?? {}).map(([k, v]) => <li key={k} className="flex justify-between gap-4"><span>{REASON_LABEL[k] ?? k}</span><strong>{v}</strong></li>)}
                </ul>
              )}
              <p className="text-sm"><Link href="/admin/inbox" className="text-deep-forest underline">Open the inbox</Link></p>
            </section>
          </div>

          <section aria-label="Review" className="space-y-3">
            <h2 className="font-heading text-xl font-semibold">Reviewing conversations</h2>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Every flagged conversation and every handoff is put on the review queue, plus a share of the rest. Mark each one fine, wrong or unsafe. An unsafe mark opens a safety incident.
            </p>
            <div className="flex flex-wrap items-start gap-6">
              <SampleShare current={typeof d.review_sample_percent === "number" ? d.review_sample_percent : null} />
              <p className="text-sm"><Link href="/admin/front-desk/reviews" className="text-deep-forest underline">Review conversations ({d.current.review?.pending ?? 0} waiting)</Link></p>
            </div>
            {d.incidents.length > 0 && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:bg-night-card">
                <p className="text-sm font-semibold">{d.incidents.length} open safety incident{d.incidents.length === 1 ? "" : "s"}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {d.incidents.map((i) => <li key={i.id}>{when(i.opened_at)}: {i.opened_note}</li>)}
                </ul>
                <p className="mt-2 text-sm"><Link href="/admin/front-desk/reviews#incidents" className="text-deep-forest underline">Close them once the rule is tightened</Link></p>
              </div>
            )}
          </section>

          <section aria-label="Reports" className="space-y-3">
            <h2 className="font-heading text-xl font-semibold">Weekly report</h2>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Emailed every Friday at 07:30 London time to the founder address. The email carries counts and topic names only, never what a visitor wrote.</p>
            <ReportNow />
            {d.reports.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">No report yet. The first one is made on the first Friday after this is switched on.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 rounded-xl border border-charcoal-ink/15 bg-white text-sm dark:border-night-ink/20 dark:bg-night-card">
                {d.reports.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                    <span className="font-medium">{fmtDay(r.week_start)}{r.week_end ? ` to ${fmtDay(r.week_end)}` : ""}</span>
                    <Badge variant={r.status === "sent" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge>
                    <span className="text-charcoal-ink/60 dark:text-night-ink/60">{r.status === "sent" ? `sent ${when(r.sent_at)}` : r.last_error ? r.last_error : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string | null; tone: Tone }) {
  return (
    <div className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/20 dark:bg-night-card">
      <p className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
      <p className="mt-1"><Badge variant={tone}>{value}</Badge></p>
      {sub && <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{sub}</p>}
    </div>
  );
}

function CountList({ items, empty }: { items: readonly { topic: string; count: number }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{empty}</p>;
  return <ul className="space-y-1 text-sm">{items.map((t) => <li key={t.topic} className="flex justify-between gap-4"><span>{topicLabel(t.topic)}</span><strong>{t.count}</strong></li>)}</ul>;
}
