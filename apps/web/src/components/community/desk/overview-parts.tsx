import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { StaffContext } from "@/lib/community/model";
import {
  actionLabel, attentionHref, elapsed, formatMinutes, SCOPE_LABEL, sortAttention, trend,
  type AttentionItem, type DeskOverview, type Priority, type Trend,
} from "@/lib/community/desk-overview";

/**
 * Pieces of the Community desk Overview. Server components, no client JavaScript. Status colour is the clinical status palette
 * (Badge), never brand colour, and every status carries words, so nothing is told by colour alone.
 */

const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none sm:p-5";
const h2 = "font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink";
const muted = "text-sm text-charcoal-ink/65 dark:text-night-ink/65";
const th = "py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60";
const td = "py-2 pr-3 align-top text-sm text-charcoal-ink dark:text-night-ink";

const PRIORITY_BADGE: Readonly<Record<Priority, { variant: "critical" | "urgent" | "attention" | "info"; text: string }>> = {
  critical: { variant: "critical", text: "Critical" },
  high: { variant: "urgent", text: "High" },
  medium: { variant: "attention", text: "Medium" },
  low: { variant: "info", text: "Low" },
};

export function SectionCard({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className={h2}>{title}</h2>
      {description && <p className={`mt-1 ${muted}`}>{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Community Safety and Attention: what needs a person now. Never shows who a member is. */
export function AttentionPanel({ items, ctx, now }: { items: AttentionItem[]; ctx: StaffContext; now: number }) {
  const sorted = sortAttention(items);
  const critical = sorted.filter((i) => i.priority === "critical").length;
  return (
    <section
      aria-labelledby="desk-attention"
      className={`${card} ${critical > 0 ? "border-status-critical/40" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="desk-attention" className={h2}>Community safety and attention</h2>
        {critical > 0 ? (
          <Badge variant="critical">{critical === 1 ? "1 critical item" : `${critical} critical items`}</Badge>
        ) : (
          <Badge variant="normal">No critical items</Badge>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className={`mt-3 ${muted}`}>Nothing is waiting. The automatic checks are running and no post, report, alert or cover gap needs a person.</p>
      ) : (
        <ul className="mt-3 divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {sorted.map((item, i) => {
            const href = attentionHref(item.href, ctx);
            const badge = PRIORITY_BADGE[item.priority];
            return (
              <li key={`${item.category}-${i}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.text}</Badge>
                    {item.overdue && <Badge variant="urgent">Overdue</Badge>}
                    <span className="font-medium text-charcoal-ink dark:text-night-ink">
                      {item.label}
                      {item.count !== undefined && item.count > 1 ? ` (${item.count})` : ""}
                    </span>
                  </div>
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {[
                      item.group_name,
                      item.received_at ? `${item.count !== undefined && item.count > 1 ? "oldest " : ""}${elapsed(item.received_at, now)}` : null,
                      `Owner: ${item.owner ?? "Unassigned"}`,
                      `Status: ${item.status.replace(/_/g, " ")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">Next: {item.next_action}</p>
                </div>
                {href && (
                  <Link
                    href={href}
                    className="shrink-0 self-start rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm font-medium text-clinical-navy hover:bg-warm-ivory dark:border-night-ink/20 dark:text-night-ink dark:hover:bg-night-ink/10"
                  >
                    Open<span className="sr-only">: {item.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function KpiCard({
  label, value, hint, trend: t, href, help,
}: { label: string; value: string | null; hint?: string; trend?: Trend | null; href?: string | null; help?: string }) {
  const body = (
    <>
      <p className="text-sm text-charcoal-ink/65 dark:text-night-ink/65">{label}</p>
      {value === null ? (
        <p className="mt-1 text-base text-charcoal-ink/50 dark:text-night-ink/55">{hint ?? "Not available yet"}</p>
      ) : (
        <p className="mt-1 font-heading text-3xl font-semibold text-charcoal-ink dark:text-night-ink">{value}</p>
      )}
      {t && <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t.text}</p>}
      {help && <p className="mt-1 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{help}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={`${card} block transition-colors hover:border-clinical-navy/40`}>{body}</Link>
  ) : (
    <div className={card}>{body}</div>
  );
}

export function KpiGrid({ data, ctx }: { data: DeskOverview; ctx: StaffContext }) {
  const k = data.kpis;
  const queueHref = ctx.is_moderator ? "/community-desk/queue" : null;
  const safetyHref = ctx.is_safety_reviewer ? "/community-desk/queue?tab=safety" : null;
  const prevLabel = data.days === 1 ? "the day before" : `the ${data.days} days before`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Active community members" value={String(k.members_active)} help={`${k.members_new} joined in this period (${k.members_new_prev} in ${prevLabel})`} />
      <KpiCard label="Active groups" value={String(k.groups_active)} />
      <KpiCard label="Posts published today" value={String(k.posts_today)} trend={trend(k.posts_today, k.posts_yesterday, "yesterday")} />
      <KpiCard label="Posts awaiting moderation" value={String(k.awaiting_moderation)} href={queueHref} help="Held by the checks or hidden after reports" />
      <KpiCard label="Open member reports" value={String(k.open_reports)} href={queueHref} />
      <KpiCard label="Open safety alerts" value={String(k.open_safety)} href={safetyHref} help={ctx.is_safety_reviewer ? undefined : "Handled by safety reviewers"} />
      <KpiCard
        label="Typical moderation response"
        value={k.response_minutes_median === null ? null : formatMinutes(k.response_minutes_median)}
        hint="No decisions in this period"
        help={k.response_decisions > 0 ? `Median of ${k.response_decisions} decision${k.response_decisions === 1 ? "" : "s"}, arrival to first decision` : undefined}
      />
      <KpiCard
        label="Moderators on duty now"
        value={String(k.moderators_on_duty)}
        help={`Safety reviewers on duty now: ${k.safety_on_duty}. From the rota, Lagos time.`}
      />
    </div>
  );
}

const SERIES_COLS: ReadonlyArray<{ key: keyof DeskOverview["series"][number]; label: string; kind: "member" | "automatic" | "person" }> = [
  { key: "posts", label: "Posts", kind: "member" },
  { key: "reported", label: "Reports", kind: "member" },
  { key: "blocked", label: "Blocked", kind: "automatic" },
  { key: "held", label: "Held", kind: "automatic" },
  { key: "auto_hidden", label: "Hidden after reports", kind: "automatic" },
  { key: "approved", label: "Approved", kind: "person" },
  { key: "removed", label: "Removed", kind: "person" },
  { key: "safety", label: "Safety alerts", kind: "automatic" },
];
const KIND_HEAD: Readonly<Record<"member" | "automatic" | "person", string>> = { member: "Members", automatic: "Automatic checks", person: "Moderator decisions" };

/** Day-by-day activity as a table: exact numbers, readable by a screen reader, and automatic actions kept apart from people's decisions. */
export function ActivityTable({ series }: { series: DeskOverview["series"] }) {
  const totals = SERIES_COLS.map((c) => series.reduce((sum, d) => sum + Number(d[c.key]), 0));
  const max = Math.max(1, ...series.map((d) => d.posts));
  if (totals.every((t) => t === 0)) {
    return <p className={muted}>No community activity in this period yet.</p>;
  }
  const rows = series.length > 31 ? series.slice(-31) : series;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <caption className="sr-only">Community activity by day</caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className={th}>Day</th>
            {(["member", "automatic", "person"] as const).map((k) => (
              <th key={k} scope="colgroup" colSpan={SERIES_COLS.filter((c) => c.kind === k).length} className={`${th} border-b border-charcoal-ink/10 dark:border-night-ink/15`}>
                {KIND_HEAD[k]}
              </th>
            ))}
          </tr>
          <tr>{SERIES_COLS.map((c) => <th key={c.key} scope="col" className={th}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-charcoal-ink/5 dark:divide-night-ink/10">
          {rows.map((d) => (
            <tr key={d.day}>
              <th scope="row" className={`${td} whitespace-nowrap font-medium`}>
                {new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" })}
              </th>
              {SERIES_COLS.map((c) => (
                <td key={c.key} className={`${td} tabular-nums`}>
                  {c.key === "posts" ? (
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right">{d.posts}</span>
                      <span aria-hidden className="h-2 rounded-full bg-clinical-navy/60" style={{ width: `${Math.round((d.posts / max) * 64)}px` }} />
                    </span>
                  ) : (
                    Number(d[c.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-charcoal-ink/15 dark:border-night-ink/20">
            <th scope="row" className={`${td} font-semibold`}>Total</th>
            {totals.map((t, i) => <td key={SERIES_COLS[i].key} className={`${td} font-semibold tabular-nums`}>{t}</td>)}
          </tr>
        </tfoot>
      </table>
      {series.length > rows.length && <p className={`mt-2 ${muted}`}>Showing the last 31 days; totals cover the whole period.</p>}
    </div>
  );
}

export function GroupsTable({ groups, sees_safety }: { groups: DeskOverview["groups"]; sees_safety: boolean }) {
  if (groups.length === 0) return <p className={muted}>No groups yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <caption className="sr-only">Community groups in this period</caption>
        <thead>
          <tr>
            {["Group", "Members", "New", "Posts", "Replies", "Reports", "Waiting", "Safety open", "Status"].map((h) => (
              <th key={h} scope="col" className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-ink/5 dark:divide-night-ink/10">
          {groups.map((g) => (
            <tr key={g.id}>
              <th scope="row" className={`${td} font-medium`}>{g.name}</th>
              <td className={`${td} tabular-nums`}>{g.members}</td>
              <td className={`${td} tabular-nums`}>{g.members_new}</td>
              <td className={`${td} tabular-nums`}>{g.posts}</td>
              <td className={`${td} tabular-nums`}>{g.replies}</td>
              <td className={`${td} tabular-nums`}>{g.reports}</td>
              <td className={`${td} tabular-nums`}>{g.outstanding}</td>
              <td className={`${td} tabular-nums`}>{g.safety_open}</td>
              <td className={td}>
                {g.safety_open > 0 && sees_safety ? (
                  <Badge variant="critical">Safety alert open</Badge>
                ) : g.outstanding > 0 ? (
                  <Badge variant="attention">Needs review</Badge>
                ) : g.status === "active" ? (
                  <Badge variant="normal">Up to date</Badge>
                ) : (
                  <Badge variant="inactive">{g.status === "draft" ? "Draft" : "Paused"}</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkloadPanel({ data, now }: { data: DeskOverview; now: number }) {
  const w = data.waiting;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { k: "Waiting in the queue", v: w.queue },
          { k: `Waiting more than ${w.queue_overdue_minutes} min`, v: w.queue_overdue },
          { k: "Open appeals", v: w.appeals },
        ].map((x) => (
          <div key={x.k} className="rounded-lg bg-warm-ivory px-3 py-2 dark:bg-night-ink/10">
            <dt className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{x.k}</dt>
            <dd className="font-heading text-2xl font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{x.v}</dd>
          </div>
        ))}
      </dl>
      {data.staff.length === 0 ? (
        <p className={muted}>Nobody holds a Community role yet. An administrator gives roles on the Moderators page.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <caption className="sr-only">People with a Community role</caption>
            <thead>
              <tr>{["Name", "Roles", "On duty now", "Actions this period", "Last action"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-charcoal-ink/5 dark:divide-night-ink/10">
              {data.staff.map((s, i) => (
                <tr key={`${s.name}-${i}`}>
                  <th scope="row" className={`${td} font-medium`}>{s.name}</th>
                  <td className={td}>
                    {s.scopes.map((sc) => SCOPE_LABEL[sc] ?? sc).join(", ")}
                    {s.group_scoped ? " (some groups only)" : ""}
                  </td>
                  <td className={td}>{s.on_duty ? <Badge variant="normal">On duty</Badge> : <Badge variant="inactive">Off rota</Badge>}</td>
                  <td className={`${td} tabular-nums`}>{s.actions}</td>
                  <td className={td}>{s.last_action_at ? elapsed(s.last_action_at, now) : "None yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`mt-2 ${muted}`}>
            Actions are counted to show where work is going, not to rank people: a safety case can rightly take far longer than a routine post.
          </p>
        </div>
      )}
    </div>
  );
}

export function ActivityFeed({ items, now }: { items: DeskOverview["activity"]; now: number }) {
  if (items.length === 0) return <p className={muted}>No moderation activity recorded yet.</p>;
  return (
    <ol className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
      {items.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between">
          <span className="text-sm text-charcoal-ink dark:text-night-ink">
            {actionLabel(e.action)}
            {e.group_name ? <span className="text-charcoal-ink/60 dark:text-night-ink/60"> · {e.group_name}</span> : null}
          </span>
          <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {e.automated ? "Automatic" : (e.actor ?? "Staff member")} · <time dateTime={e.at}>{elapsed(e.at, now)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
