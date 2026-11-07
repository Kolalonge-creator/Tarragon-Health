"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { describe } from "@/lib/notifications/describe-in-app";
import { NOTIFICATION_CATEGORIES, categoryFor, type NotificationCategory } from "@/lib/notifications/categories";
import {
  useInAppNotificationHistory,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "@/lib/queries/notifications";
import { useActingFor } from "@/components/acting-for-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";

const CHIP =
  "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2";
const CHIP_ON =
  "border-brand-green bg-brand-green text-white dark:border-brand-green-bright dark:bg-brand-green-bright dark:text-night-ground";
const CHIP_OFF =
  "border-charcoal-ink/15 bg-white text-charcoal-ink hover:border-brand-green/50 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink";
const MUTED = "text-xs text-charcoal-ink/60 dark:text-night-ink/60";

/**
 * P19: every in-app notification the signed-in person has had, with the bell's own wording and link (describe-in-app.ts), so no
 * notification says more here than it already says in the bell. Grouped by category filters, marked read one by one or all at once.
 * Notifications always belong to the signed-in person: while managing someone else's account this page still shows your own, and
 * says so, because the person you help gets theirs in their own account.
 */
export function NotificationCentre() {
  const acting = useActingFor();
  const history = useInAppNotificationHistory();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<NotificationCategory | null>(null);

  const all = (history.data?.pages ?? []).flatMap((p) => p.rows).map((n) => {
    const { text, href } = describe(n);
    return { n, text, href, category: categoryFor(n.template, href) };
  });
  const shown = filter ? all.filter((x) => x.category === filter) : all;
  const unreadShown = shown.filter((x) => x.n.status === "pending");

  return (
    <div className="space-y-4">
      {acting && (
        <p className="rounded-lg border border-charcoal-ink/10 p-3 text-xs text-charcoal-ink/70 dark:border-night-ink/15 dark:text-night-ink/70">
          These are your own notifications. {acting.fullName?.trim().split(/\s+/)[0] ?? "The person you help"} gets theirs in their own account.
        </p>
      )}
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {[{ id: null, label: "All" } as const, ...NOTIFICATION_CATEGORIES].map((option) => {
          const active = option.id === filter;
          return (
            <button
              key={option.id ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option.id)}
              className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {(markRead.isError || markAllRead.isError) && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t mark that as read. Please try again.
            </p>
          )}
          {unreadShown.length > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate(unreadShown.map((x) => x.n.id))}
              >
                Mark all as read
              </Button>
            </div>
          )}
          {history.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
          {history.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t load your notifications. Please refresh the page to try again.
            </p>
          )}
          {history.data && shown.length === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {filter ? "Nothing in this group yet." : "No notifications yet."}
            </p>
          )}
          {shown.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {shown.map(({ n, text, href, category }) => {
                const unread = n.status === "pending";
                return (
                  <li key={n.id} className="flex flex-wrap items-start gap-3 py-3">
                    {unread && <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={href}
                        onClick={() => {
                          if (unread) markRead.mutate(n.id);
                        }}
                        className={cn("text-sm text-charcoal-ink hover:underline dark:text-night-ink", unread && "font-medium")}
                      >
                        {text}
                        {unread && <span className="sr-only"> (unread)</span>}
                      </Link>
                      <p className={MUTED}>
                        {NOTIFICATION_CATEGORIES.find((c) => c.id === category)?.label} ·{" "}
                        {formatPatientDateTime(n.created_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {unread && (
                      <Button size="sm" variant="ghost" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                        Mark as read
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {history.hasNextPage && (
            <Button size="sm" variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>
              {history.isFetchingNextPage ? "Loading…" : "Show older notifications"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
