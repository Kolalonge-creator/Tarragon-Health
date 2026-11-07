"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarClock, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { cn } from "@/lib/utils";
import { getLagosGreetingWord } from "@/lib/greeting";
import { refreshQueryState } from "@/lib/queries/list-query-state";
import {
  WORK_ITEM_LIMIT,
  coordinationKeys,
  useCoordinationActivity,
  useCoordinationAppointments,
  useCoordinationWorkItems,
  type CoordinationAppointment,
} from "@/lib/queries/coordination";
import {
  ACTIVITY_LABEL,
  ATTENTION_LABEL,
  CATEGORY_LABEL,
  computeKpis,
  countByCategory,
  daysWaiting,
  lagosDay,
  needsAttention,
  sortItems,
  workItemHref,
  type CoordinationKpis,
  type WorkCategory,
} from "@/lib/care-coordinator/work-items";
import { useWorkspace } from "./_workspace/workspace-context";
import { WorkTable } from "./_workspace/work-table";
import { useHydrated } from "./_workspace/use-hydrated";
import { workItemTitle } from "./_workspace/work-item-labels";
import { dueText, formatLagosDate, formatLagosTime, timeAgo } from "./_workspace/format";

const WORKLIST = "/dashboard/care-coordinator/worklist";

type Kpi = { key: keyof CoordinationKpis; label: string; hint: string; href: string; tone?: "warn" };
const KPIS: Kpi[] = [
  { key: "myOpen", label: "My open tasks", hint: "Everything on your list", href: `${WORKLIST}?view=mine` },
  { key: "dueToday", label: "Due today", hint: "Yours, due before midnight", href: `${WORKLIST}?view=due_today` },
  { key: "overdue", label: "Overdue", hint: "Yours, past the due date", href: `${WORKLIST}?view=overdue`, tone: "warn" },
  { key: "awaitingPatient", label: "Awaiting patient", hint: "Yours, waiting on a reply", href: `${WORKLIST}?view=awaiting_patient` },
  { key: "openSupport", label: "Support requests", hint: "Open across the team", href: "/dashboard/care-coordinator/support-requests" },
  { key: "resultFollowUps", label: "Result follow-ups", hint: "Self-arranged tests not uploaded", href: "/dashboard/care-coordinator/follow-ups" },
  { key: "unassigned", label: "Unassigned", hint: "Nobody holds these yet", href: `${WORKLIST}?view=unassigned` },
  { key: "heldByDoctors", label: "Held by doctors", hint: "Moves to a coordinator once one is active", href: `${WORKLIST}?view=all` },
];

const CATEGORY_HREF: Record<WorkCategory, string> = {
  outreach: "/dashboard/care-coordinator/outreach",
  follow_up: "/dashboard/care-coordinator/follow-ups",
  support: "/dashboard/care-coordinator/support-requests",
  programme: "/dashboard/care-coordinator/programme-tasks",
  queue: "/clinician/queue",
};

const APPT_LABEL: Record<string, string> = {
  telemedicine: "Doctor meeting",
  result_interpretation: "Results meeting",
  dietitian: "Dietitian",
  pharmacist: "Pharmacist",
};
const MISSED_LABEL: Record<string, string> = { no_show: "Missed", provider_cancelled: "Cancelled by clinician", failed: "Did not connect" };

function Panel({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="min-w-0 rounded-2xl border border-charcoal-ink/10 bg-white p-4 sm:p-5 dark:border-night-ink/15 dark:bg-night-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-green hover:underline">
      {children} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

function ApptRow({ a }: { a: CoordinationAppointment }) {
  const { openPatient } = useWorkspace();
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <button type="button" onClick={() => openPatient(a.patient_id)} className="truncate text-left font-semibold text-charcoal-ink hover:underline dark:text-night-ink">
          {a.patient?.full_name ?? "Patient"}
        </button>
        <p className="truncate text-xs text-charcoal-ink/55">
          {APPT_LABEL[a.appointment_type] ?? a.appointment_type.replace(/_/g, " ")}
          {a.clinician?.full_name ? ` with ${a.clinician.full_name}` : ""}
          {a.payment_status === "pending" ? " · awaiting payment" : ""}
        </p>
      </div>
      <span className="whitespace-nowrap tabular-nums text-charcoal-ink/70">{formatLagosTime(a.scheduled_for)}</span>
    </li>
  );
}

export function CommandCentre() {
  const { userId, firstName } = useWorkspace();
  const qc = useQueryClient();
  const itemsQ = useCoordinationWorkItems();
  const apptQ = useCoordinationAppointments();
  const activityQ = useCoordinationActivity(12);
  // Cached data is read only after hydration, so the first browser render matches the server HTML (see use-hydrated.ts).
  const hydrated = useHydrated();
  const itemsData = hydrated ? itemsQ.data : undefined;
  const apptData = hydrated ? apptQ.data : undefined;
  const activityData = hydrated ? activityQ.data : undefined;
  const now = new Date();

  const itemsState = hydrated ? refreshQueryState({ isLoading: itemsQ.isLoading, isError: itemsQ.isError, hasData: itemsQ.data !== undefined }) : "loading";
  const items = itemsData ?? [];
  const kpis = itemsData ? computeKpis(items, userId, now) : null;
  const attention = needsAttention(items, userId, now).slice(0, 6);
  const today = sortItems(items.filter((i) => i.assigned_to === userId), "priority", now).slice(0, 8);
  const byCategory = countByCategory(items);
  const maxCat = Math.max(1, ...byCategory.map((c) => c.count));

  const todayKey = lagosDay(now);
  const tomorrowKey = lagosDay(new Date(now.getTime() + 86_400_000));
  const upcoming = apptData?.upcoming ?? [];
  const apptGroups = [
    { label: "Today", rows: upcoming.filter((a) => lagosDay(new Date(a.scheduled_for)) === todayKey) },
    { label: "Tomorrow", rows: upcoming.filter((a) => lagosDay(new Date(a.scheduled_for)) === tomorrowKey) },
  ];
  const laterCount = upcoming.length - apptGroups[0].rows.length - apptGroups[1].rows.length;

  const updatedAt = hydrated && itemsQ.dataUpdatedAt ? new Date(itemsQ.dataUpdatedAt) : null;

  return (
    <div className="space-y-5">
      {/* Greeting and freshness */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-charcoal-ink dark:text-night-ink">
            Good {getLagosGreetingWord(now)}{firstName ? `, ${firstName}` : ""}. Here&rsquo;s your care coordination overview.
          </p>
          <p className="text-sm text-charcoal-ink/60">
            {now.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" })}
            {kpis ? ` · ${kpis.myOpen} task${kpis.myOpen === 1 ? "" : "s"} on your list` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-charcoal-ink/55">
          {updatedAt && <span>Updated {formatLagosTime(updatedAt.toISOString())}</span>}
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: coordinationKeys.all })}
            className="inline-flex items-center gap-1 rounded-md border border-charcoal-ink/15 px-2 py-1 font-medium text-charcoal-ink/75 hover:bg-charcoal-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", hydrated && itemsQ.isFetching && "animate-spin")} aria-hidden /> Refresh
          </button>
        </div>
      </div>

      {itemsState === "failed" && (
        <LoadFailure>
          The worklist could not be loaded, so every count below is unknown, not zero. Do not read this page as a quiet day. Reload, or work
          from the individual pages in the menu.
        </LoadFailure>
      )}
      {itemsState === "stale" && (
        <StaleDataNotice>The worklist could not be refreshed just now. What you see is the last good read, a few minutes old.</StaleDataNotice>
      )}
      {items.length >= WORK_ITEM_LIMIT && (
        <StaleDataNotice>
          More than {WORK_ITEM_LIMIT} items are open. Only the oldest {WORK_ITEM_LIMIT} are shown here, so the counts are a floor. Tell the
          care lead: a backlog this size needs more hands.
        </StaleDataNotice>
      )}

      {/* Needs your attention */}
      <Panel
        id="needs-attention"
        title="Needs your attention"
        action={<PanelLink href={`${WORKLIST}?view=overdue`}>See all overdue</PanelLink>}
      >
        {itemsState === "loading" ? (
          <p className="text-sm text-charcoal-ink/60">Checking your work…</p>
        ) : itemsState === "failed" ? (
          <p className="text-sm text-charcoal-ink/60">Unknown until the worklist loads.</p>
        ) : attention.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing overdue, marked act first, or waiting more than three days on your list or unassigned.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/[0.07] dark:divide-night-ink/10">
            {attention.map(({ item, reason }) => (
              <li key={`${item.source}-${item.item_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span
                  className={cn(
                    "inline-flex w-36 shrink-0 items-center gap-1.5 text-xs font-semibold",
                    reason === "overdue" ? "text-status-attention-text" : reason === "act_first" ? "text-status-urgent-text" : "text-charcoal-ink/60",
                  )}
                >
                  {reason === "waiting" ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
                  {ATTENTION_LABEL[reason]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-charcoal-ink dark:text-night-ink">{item.patient_name ?? "Patient"}</span>
                  <span className="text-charcoal-ink/60"> · {workItemTitle(item)}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-charcoal-ink/55">
                  {item.due_at ? dueText(item.due_at, now) : `Waiting ${daysWaiting(item, now)}d`} · {item.assigned_to ? (item.assigned_to === userId ? "You" : item.assigned_name) : "Unassigned"}
                </span>
                <Link href={workItemHref(item)} className="text-xs font-semibold text-brand-green hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {KPIS.map((k) => {
          const value = kpis ? kpis[k.key] : null;
          return (
            <Link
              key={k.key}
              href={k.href}
              className="group rounded-xl border border-charcoal-ink/10 bg-white p-4 transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:border-night-ink/15 dark:bg-night-card"
            >
              <p className="text-xs font-medium text-charcoal-ink/60">{k.label}</p>
              <p
                className={cn(
                  "mt-1 font-heading text-2xl font-semibold tabular-nums",
                  k.tone === "warn" && value ? "text-status-attention-text" : "text-charcoal-ink dark:text-night-ink",
                )}
              >
                {itemsState === "failed" ? "?" : value === null ? "…" : value}
              </p>
              <p className="mt-0.5 text-xs text-charcoal-ink/50">{itemsState === "failed" ? "Could not be loaded" : k.hint}</p>
            </Link>
          );
        })}
      </div>

      {/* Today's worklist + where the work is */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel id="today-worklist" title="Your worklist" action={<PanelLink href={`${WORKLIST}?view=mine`}>Open full worklist</PanelLink>}>
          {itemsState === "failed" ? (
            <p className="text-sm text-charcoal-ink/60">Unknown until the worklist loads.</p>
          ) : (
            <WorkTable items={today} compact emptyText={itemsState === "loading" ? "Loading…" : "Nothing on your list. Take something from the unassigned view, or enjoy the quiet."} />
          )}
        </Panel>
        <Panel id="where-work-is" title="Where the work is">
          <ul className="space-y-2.5">
            {byCategory.map((c) => (
              <li key={c.category}>
                <Link href={CATEGORY_HREF[c.category]} className="group block">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-charcoal-ink/80 group-hover:underline dark:text-night-ink/80">{CATEGORY_LABEL[c.category]}</span>
                    <span className="tabular-nums font-semibold text-charcoal-ink dark:text-night-ink">{itemsState === "failed" ? "?" : c.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-charcoal-ink/[0.06]">
                    <div className="h-full rounded-full bg-brand-green/70" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-charcoal-ink/50">Open items across the team, from the same records the doctors work from.</p>
        </Panel>
      </div>

      {/* Appointments + recent activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel id="appointments" title="Appointments" action={<CalendarClock className="h-4 w-4 text-charcoal-ink/40" aria-hidden />}>
          {hydrated && apptQ.isError && !apptData ? (
            <LoadFailure>Appointments could not be loaded. Reload before assuming the day is clear.</LoadFailure>
          ) : (
            <div className="space-y-3">
              {apptGroups.map((g) => (
                <div key={g.label}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
                    {g.label} ({g.rows.length})
                  </p>
                  {g.rows.length === 0 ? (
                    <p className="py-1 text-sm text-charcoal-ink/55">{!apptData ? "Loading…" : "None."}</p>
                  ) : (
                    <ul className="divide-y divide-charcoal-ink/[0.07]">
                      {g.rows.map((a) => (
                        <ApptRow key={a.id} a={a} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {laterCount > 0 && <p className="text-xs text-charcoal-ink/55">{laterCount} more in the next 7 days.</p>}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
                  Needs a follow-up call ({apptData?.needsFollowUp.length ?? 0})
                </p>
                {(apptData?.needsFollowUp ?? []).length === 0 ? (
                  <p className="py-1 text-sm text-charcoal-ink/55">No missed or failed appointments in the last 7 days.</p>
                ) : (
                  <ul className="divide-y divide-charcoal-ink/[0.07]">
                    {apptData?.needsFollowUp.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium text-charcoal-ink dark:text-night-ink">{a.patient?.full_name ?? "Patient"}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="amber">{MISSED_LABEL[a.status] ?? a.status}</Badge>
                          <span className="tabular-nums text-xs text-charcoal-ink/55">{formatLagosDate(a.scheduled_for)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel id="recent-activity" title="Recent activity" action={<PanelLink href="/dashboard/care-coordinator/contact-log">Contact log</PanelLink>}>
          {hydrated && activityQ.isError && !activityData ? (
            <LoadFailure>Recent activity could not be loaded.</LoadFailure>
          ) : (activityData ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{!activityData ? "Loading…" : "Nothing done in the last 14 days yet."}</p>
          ) : (
            <ol className="space-y-2.5">
              {activityData?.map((e) => (
                <li key={`${e.kind}-${e.event_id}`} className="flex gap-3 text-sm">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-green/60" />
                  <div className="min-w-0">
                    <p className="text-charcoal-ink dark:text-night-ink">
                      <span className="font-medium">{ACTIVITY_LABEL[e.kind]}</span>
                      <span className="text-charcoal-ink/60"> · {e.patient_name ?? "Patient"}</span>
                    </p>
                    <p className="text-xs text-charcoal-ink/50">
                      {e.actor_name ?? "Someone"} · {timeAgo(e.occurred_at, now)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
