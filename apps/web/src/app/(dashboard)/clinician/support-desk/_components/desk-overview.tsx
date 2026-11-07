"use client";

import Link from "next/link";
import { useState } from "react";
import { AlarmClock, CheckCircle2, Gauge, Inbox, MessageSquareReply, Smile, Timer, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { statTileValue } from "@/components/ui/stat-tile-value";
import { useSupportDeskSummary, useSupportWorkItems, type DeskSummary } from "@/lib/queries/support-desk";
import {
  ATTENTION_LABEL,
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  attentionItems,
  describeDue,
  formatMinutes,
  workloadByOwner,
  type Priority,
  type StatusGroup,
  type WorkItem,
  type WorkSource,
} from "@/lib/support-desk/model";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

function delta(current: number | null | undefined, previous: number | null | undefined, lowerIsBetter = false) {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return undefined;
  const diff = current - previous;
  if (diff === 0) return { text: "Same as the period before", direction: "flat" as const };
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return { text: `${diff > 0 ? "Up" : "Down"} ${Math.abs(Math.round(diff))} on the period before`, direction: better ? ("up" as const) : ("down" as const) };
}

function countBy(items: readonly WorkItem[], key: (i: WorkItem) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = key(i) ?? "other";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function Bars({ rows, label }: { rows: [string, number][]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  if (rows.length === 0) return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing in this period.</p>;
  return (
    <ul className="space-y-2">
      {rows.map(([k, n]) => (
        <li key={k} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate text-charcoal-ink/80 dark:text-night-ink/80">{label(k)}</span>
          <span className="h-2 rounded-full bg-charcoal-ink/5 dark:bg-night-ink/10">
            <span className="block h-2 rounded-full bg-brand-green" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-charcoal-ink/70 dark:text-night-ink/70">{n}</span>
        </li>
      ))}
    </ul>
  );
}

function Kpis({ s }: { s: DeskSummary }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Link href="/clinician/support-desk/queue?tab=open">
        <StatTile icon={Inbox} label="Open" {...statTileValue(s.open, "Nothing open")} />
      </Link>
      <Link href="/clinician/support-desk/queue?tab=unassigned">
        <StatTile icon={UserX} label="No owner yet" iconTint={s.unassigned > 0 ? "gold" : "sage"} {...statTileValue(s.unassigned, "None")} />
      </Link>
      <StatTile icon={MessageSquareReply} label="Received today" {...statTileValue(s.received_today, "None yet today")} />
      <StatTile icon={CheckCircle2} label="Resolved today" {...statTileValue(s.resolved_today, "None yet today")} />
      <StatTile
        icon={Timer}
        label="First reply (median)"
        {...statTileValue(s.median_first_response_min === null ? null : formatMinutes(s.median_first_response_min), "No replies in this period")}
        delta={delta(s.median_first_response_min, s.prev_median_first_response_min, true)}
      />
      <StatTile
        icon={AlarmClock}
        label="Time to resolve (median)"
        {...statTileValue(s.median_resolution_min === null ? null : formatMinutes(s.median_resolution_min), "Nothing resolved in this period")}
      />
      <Link href="/clinician/support-desk/queue?tab=open&sla=breached">
        <StatTile
          icon={Gauge}
          label="First reply on target"
          {...statTileValue(s.sla_compliance_pct === null ? null : `${s.sla_compliance_pct}%`, "No item due yet")}
          status={s.breached > 0 ? { text: `${s.breached} past target now`, tone: "red" } : undefined}
        />
      </Link>
      <StatTile
        icon={Smile}
        label="Customer satisfaction"
        {...statTileValue(
          s.csat_avg === null ? null : `${s.csat_avg} / 5`,
          s.csat_count === 0 ? "Not yet available: no ratings" : `Not yet available: ${s.csat_count} rating${s.csat_count === 1 ? "" : "s"}, 5 needed`,
        )}
      />
    </div>
  );
}

export function DeskOverview() {
  const [days, setDays] = useState(7);
  const summary = useSupportDeskSummary(days);
  const items = useSupportWorkItems();
  const now = new Date();
  const rows = items.data ?? [];
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  const inPeriod = rows.filter((i) => !i.is_test && Date.parse(i.received_at ?? "") >= since);
  const attention = attentionItems(rows);
  const workload = workloadByOwner(rows);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Needs attention now</CardTitle>
          <CardDescription>Past target or due soon, then high-priority work with no owner, then new complaints.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {items.isError && <p role="alert" className="text-sm text-red-700">The queue could not be loaded. Open each worklist directly until this is fixed.</p>}
          {items.data && attention.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing needs attention right now.</p>}
          {attention.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Reference</th>
                    <th className="py-2 pr-3 font-medium">Why</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Priority</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map(({ item, reason, next }) => (
                    <tr key={`${item.source}:${item.item_id}`} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                      <td className="py-2 pr-3">
                        <Link href={item.detail_href ?? "#"} className="font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright">
                          {item.reference}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={reason === "past_target" ? "red" : reason === "due_soon" ? "amber" : "grey"}>{ATTENTION_LABEL[reason]}</Badge>
                      </td>
                      <td className="py-2 pr-3">{SOURCE_LABEL[item.source as WorkSource] ?? item.source}</td>
                      <td className="py-2 pr-3">{PRIORITY_LABEL[item.priority as Priority] ?? item.priority}</td>
                      <td className="py-2 pr-3">{item.assigned_to_name ?? "No owner"}</td>
                      <td className="py-2 pr-3 tabular-nums">{describeDue(item.next_due_at, now) ?? "No target"}</td>
                      <td className="py-2 pr-3">{STATUS_LABEL[item.status_group as StatusGroup] ?? item.status_group}</td>
                      <td className="py-2">{next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">How the desk is doing</h2>
        <label className="flex items-center gap-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Period
          <select
            className="rounded-md border border-charcoal-ink/15 bg-white px-2 py-1 text-sm dark:border-night-ink/20 dark:bg-transparent"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {summary.isError && <p role="alert" className="text-sm text-red-700">The figures could not be loaded.</p>}
      {summary.data && <Kpis s={summary.data} />}
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">
        Targets are internal (Urgent 1 hour; High 4 business hours; Normal 1 business day; Low 2 business days), counted in staffed hours. Clinical items run on the clinical route and are not counted here. Test accounts are left out.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Received by type</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={countBy(inPeriod, (i) => i.source)} label={(k) => SOURCE_LABEL[k as WorkSource] ?? k} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Received by category</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={countBy(inPeriod, (i) => i.category)} label={(k) => CATEGORY_LABEL[k] ?? k} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Received by priority</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={countBy(inPeriod, (i) => i.priority)} label={(k) => PRIORITY_LABEL[k as Priority] ?? k} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Team workload</CardTitle>
            <CardDescription>Open work per owner. Counts show where help is needed, not who is fastest.</CardDescription>
          </CardHeader>
          <CardContent>
            {workload.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No open work has an owner yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <tr>
                    <th className="py-1 font-medium">Owner</th>
                    <th className="py-1 text-right font-medium">Open</th>
                    <th className="py-1 text-right font-medium">Past target</th>
                    <th className="py-1 text-right font-medium">Waiting on customer</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.ownerId} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                      <td className="py-1.5">{w.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{w.open}</td>
                      <td className="py-1.5 text-right tabular-nums">{w.late}</td>
                      <td className="py-1.5 text-right tabular-nums">{w.waitingOnCustomer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
