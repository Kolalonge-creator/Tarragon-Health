"use client";

import Link from "next/link";
import {
  useOutreachTasks,
  useRecentOutreachContacts,
  useResolvedOutreachCountThisWeek,
  useOutreachContactCountThisWeek,
} from "@/lib/queries/care-outreach";
import { TRIGGER_LABEL, triggerContext } from "@/components/clinical/outreach-worklist";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { refreshQueryState } from "@/lib/queries/list-query-state";

const CHANNEL_LABEL = { call: "Call", whatsapp: "WhatsApp" } as const;

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CareCoordinatorOverview() {
  // Every hook below throws on a Postgrest error, which is what separates
  // "there is genuinely nothing to do" from "we never got an answer".
  // Reading only `data` turned the second into the first: five zero tiles and
  // "Nothing marked act-first. Nice and quiet." on a coordinator's one
  // worklist. A count that failed to load is shown as unknown, not zero.
  const tasksQuery = useOutreachTasks();
  const contactsQuery = useRecentOutreachContacts(3);
  const resolvedQuery = useResolvedOutreachCountThisWeek();
  const contactsCountQuery = useOutreachContactCountThisWeek();

  const { data: tasks } = tasksQuery;
  const { data: contacts } = contactsQuery;
  const { data: resolvedThisWeek } = resolvedQuery;
  const { data: contactsThisWeek } = contactsCountQuery;

  // Three states, not two. These hooks poll every 60 seconds, and React Query
  // keeps the last good `data` when a refetch fails, so branching on isError
  // alone threw away a coordinator's whole board because one poll timed out.
  // "failed" (nothing ever arrived) stays loud and still refuses to show a
  // zero; "stale" keeps the numbers and says they may have moved on.
  const states = {
    tasks: refreshQueryState({
      isLoading: tasksQuery.isLoading,
      isError: tasksQuery.isError,
      hasData: tasks !== undefined,
    }),
    contacts: refreshQueryState({
      isLoading: contactsQuery.isLoading,
      isError: contactsQuery.isError,
      hasData: contacts !== undefined,
    }),
    resolved: refreshQueryState({
      isLoading: resolvedQuery.isLoading,
      isError: resolvedQuery.isError,
      hasData: resolvedThisWeek !== undefined,
    }),
    contactsCount: refreshQueryState({
      isLoading: contactsCountQuery.isLoading,
      isError: contactsCountQuery.isError,
      hasData: contactsThisWeek !== undefined,
    }),
  } as const;
  const allStates = Object.values(states);

  const tasksLoading = states.tasks === "loading";
  const contactsLoading = states.contacts === "loading";
  const tasksFailed = states.tasks === "failed";
  const contactsFailed = states.contacts === "failed";
  const resolvedFailed = states.resolved === "failed";
  const contactsCountFailed = states.contactsCount === "failed";

  const UNKNOWN = { hint: "Could not be loaded" };

  const openTasks = tasks ?? [];
  const actFirst = openTasks.filter((t) => t.priority === 1).slice(0, 3);
  const followUps = openTasks.filter((t) => t.trigger_type === "awaiting_result").slice(0, 3);

  return (
    <div className="space-y-5">
      {allStates.includes("failed") && (
        <LoadFailure>
          Part of this overview could not be loaded. Anything marked &ldquo;could not be
          loaded&rdquo; is unknown, not zero, so do not read this page as a quiet day. Reload it, or
          work from the worklist pages directly.
        </LoadFailure>
      )}

      {!allStates.includes("failed") && allStates.includes("stale") && (
        <StaleDataNotice>
          Part of this overview could not be refreshed just now. What you can see is the last we
          read successfully, so treat it as a few minutes old rather than a live board.
        </StaleDataNotice>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tasksFailed ? (
          <StatTile icon={SEMANTIC_ICON.carePlan} label="Open outreach tasks" empty={UNKNOWN} />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.carePlan}
            label="Open outreach tasks"
            value={tasksLoading ? "…" : String(openTasks.length)}
          />
        )}
        {tasksFailed ? (
          <StatTile
            icon={NAV_ICON.warning}
            tintClassName="bg-red-100"
            iconClassName="text-red-700"
            label="Act-first"
            empty={UNKNOWN}
          />
        ) : (
          <StatTile
            icon={NAV_ICON.warning}
            tintClassName="bg-red-100"
            iconClassName="text-red-700"
            label="Act-first"
            value={tasksLoading ? "…" : String(openTasks.filter((t) => t.priority === 1).length)}
          />
        )}
        {tasksFailed ? (
          <StatTile icon={SEMANTIC_ICON.labs} label="Follow-ups pending" empty={UNKNOWN} />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.labs}
            label="Follow-ups pending"
            value={
              tasksLoading
                ? "…"
                : String(openTasks.filter((t) => t.trigger_type === "awaiting_result").length)
            }
          />
        )}
        {contactsCountFailed ? (
          <StatTile icon={NAV_ICON.messages} label="Contacts logged (7d)" empty={UNKNOWN} />
        ) : (
          <StatTile
            icon={NAV_ICON.messages}
            label="Contacts logged (7d)"
            value={contactsThisWeek === undefined ? "…" : String(contactsThisWeek)}
          />
        )}
        {resolvedFailed ? (
          <StatTile icon={NAV_ICON.approvals} label="Resolved this week" empty={UNKNOWN} />
        ) : (
          <StatTile
            icon={NAV_ICON.approvals}
            label="Resolved this week"
            value={resolvedThisWeek === undefined ? "…" : String(resolvedThisWeek)}
          />
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Act-first outreach</CardTitle>
          <Link
            href="/dashboard/care-coordinator/outreach"
            className="text-sm font-semibold text-brand-green hover:underline"
          >
            Open worklist →
          </Link>
        </CardHeader>
        <CardContent>
          {tasksFailed ? (
            <LoadFailure>
              Outreach tasks could not be loaded, so this is not a quiet board: it is an unread
              one. Reload before assuming nothing is act-first.
            </LoadFailure>
          ) : actFirst.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {tasksLoading ? "Loading…" : "Nothing marked act-first. Nice and quiet."}
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {actFirst.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-semibold text-charcoal-ink">
                      {t.patient?.full_name ?? "Patient"}
                    </span>
                    {triggerContext(t) && (
                      <span className="ml-1.5 text-charcoal-ink/50">{triggerContext(t)}</span>
                    )}
                    <p className="text-xs text-charcoal-ink/50">
                      {t.assigned_owner?.full_name ?? "Unassigned"} · {timeAgo(t.created_at)}
                    </p>
                  </div>
                  <Badge variant="blue">{TRIGGER_LABEL[t.trigger_type] ?? t.trigger_type}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Follow-ups pending</CardTitle>
            <Link
              href="/dashboard/care-coordinator/follow-ups"
              className="text-sm font-semibold text-brand-green hover:underline"
            >
              Open follow-ups →
            </Link>
          </CardHeader>
          <CardContent>
            {tasksFailed ? (
              <LoadFailure>
                Follow-ups could not be loaded. Reload before assuming no self-arranged test is
                overdue.
              </LoadFailure>
            ) : followUps.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">
                {tasksLoading ? "Loading…" : "No self-arranged test is overdue right now."}
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {followUps.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold text-charcoal-ink">
                        {t.patient?.full_name ?? "Patient"}
                      </span>
                      {triggerContext(t) && (
                        <span className="ml-1.5 text-charcoal-ink/50">{triggerContext(t)}</span>
                      )}
                      <p className="text-xs text-charcoal-ink/50">
                        {t.assigned_owner?.full_name ?? "Unassigned"} · {timeAgo(t.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent contact log</CardTitle>
            <Link
              href="/dashboard/care-coordinator/contact-log"
              className="text-sm font-semibold text-brand-green hover:underline"
            >
              Open contact log →
            </Link>
          </CardHeader>
          <CardContent>
            {contactsFailed ? (
              <LoadFailure>The contact log could not be loaded. Reload to see it.</LoadFailure>
            ) : !contacts || contacts.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">
                {contactsLoading ? "Loading…" : "No outreach contacts logged yet."}
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                    <span className="font-semibold text-charcoal-ink">
                      {c.patient?.full_name ?? "Patient"}
                    </span>
                    <Badge variant="grey">{CHANNEL_LABEL[c.channel]}</Badge>
                    <span className="flex-1 truncate text-charcoal-ink/55">{c.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
