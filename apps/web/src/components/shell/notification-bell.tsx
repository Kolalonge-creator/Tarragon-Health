"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { describe } from "@/lib/notifications/describe-in-app";
import {
  useInAppNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useRespondToNotification,
  type InAppNotification,
} from "@/lib/queries/notifications";

/**
 * Spec §76.13 ("notification priority") — Critical/Important/Routine, so a
 * patient can tell an appointment reminder apart from a clinical safety
 * alert at a glance. Deliberately NOT a new DB column: `notifications.
 * priority` (routine/critical) is live, load-bearing input to the critical-
 * notification escalation engine (private.escalate_unconfirmed_critical_
 * notifications) and is not touched here. This is a purely client-side
 * DISPLAY tier: any row the DB already marked `priority = 'critical'`
 * always displays "Critical"; a curated handful of templates that are
 * known-safety-relevant but might reach this table via a plain (non-
 * escalation-engine) insert are treated as critical too, defensively; every
 * other routine row is split Important/Routine by template. Anything
 * unmapped defaults to "important", never "routine" — the same
 * never-silently-downgrade principle this codebase already applies to
 * priority classification elsewhere.
 */
const ALWAYS_CRITICAL_TEMPLATES = new Set<string>([
  "free_tier_reading_self_care_suggestion",
  "emergency_followup",
  "critical_notification_escalation_exhausted",
  // The unacknowledged-alert escalation ladder. Live rows arrive with
  // priority 'routine' as often as 'critical' (the escalation engine sets it
  // per hop), and an alert nobody has picked up is exactly the thing that
  // must not read as an ordinary update.
  "clinician_alert_ack_timeout_backup",
  "clinician_alert_ack_timeout_senior",
  "clinician_alert_ack_timeout_admin",
  "clinician_alert_sla_breach",
  "abnormal_result_patient_followup",
]);

const ROUTINE_TEMPLATES = new Set<string>([
  "health_education_unlock",
  "health_reset_complete",
  "voucher_gift_used",
  "care_voucher_expiring",
  "service_purchase_expiring",
  "reward_voucher_issued",
  "sponsor_monthly_report",
  "sponsor_care_reviewed",
  "sponsor_person_quiet",
  "sponsored_plan_started",
  "region_now_available",
  "wellness_challenge_ending",
  "second_condition_needs_upgrade",
  "engagement_reengagement_nudge",
]);

type DisplayTier = "critical" | "important" | "routine";

const TIER_STYLE: Record<DisplayTier, { label: string; className: string }> = {
  critical: {
    label: "Critical",
    className: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-300",
  },
  important: {
    label: "Important",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-300",
  },
  routine: {
    label: "Routine",
    className:
      "bg-charcoal-ink/10 text-charcoal-ink/60 dark:bg-night-ink/10 dark:text-night-ink/70",
  },
};

function displayTier(n: InAppNotification): DisplayTier {
  const template = n.template ?? "";
  if (n.priority === "critical" || ALWAYS_CRITICAL_TEMPLATES.has(template)) return "critical";
  if (ROUTINE_TEMPLATES.has(template)) return "routine";
  return "important";
}

interface ResponseOption {
  label: string;
  value: string;
}

export { describe };


function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Reads the `notifications` table's in_app channel — see lib/queries/notifications.ts
 * for why this exists (the channel and its RLS predate any UI that showed it). */
export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data } = useInAppNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const respond = useRespondToNotification();

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const items = data ?? [];
  const unread = items.filter((n) => n.status === "pending");

  const openItem = (n: InAppNotification) => {
    if (n.status === "pending") markRead.mutate(n.id);
    setOpen(false);
    router.push(describe(n).href);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0 text-charcoal-ink/60 hover:text-charcoal-ink dark:text-night-ink/60 dark:hover:text-night-ink"
        aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <NAV_ICON.bell className="h-5 w-5" strokeWidth={2} />
        {unread.length > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-semibold text-white"
          >
            {/* Was capped at "9+" — with any double-digit unread count, opening
                one notification (say 12 -> 11) still showed "9+", reading as
                the badge not updating at all even though it was. 99 gives
                real headroom for the count to visibly move before capping. */}
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-charcoal-ink/10 bg-white shadow-lg dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
          <div className="flex items-center justify-between border-b border-charcoal-ink/10 px-4 py-2.5 dark:border-night-ink/15">
            <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Notifications</p>
            {unread.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-brand-green hover:underline dark:text-brand-green-bright"
                onClick={() => markAllRead.mutate(unread.map((n) => n.id))}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-charcoal-ink/50 dark:text-night-ink/55">
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {items.map((n) => {
                  const { text } = describe(n);
                  const tier = TIER_STYLE[displayTier(n)];
                  // Two-way communication (17.9) — a quick-reply option set
                  // attached at send time (e.g. appointment_reminder's
                  // confirm/reschedule/cancel/need_help). Rendered as its
                  // own row of buttons, never folded into the row's own
                  // click-to-navigate button, so tapping a reply doesn't
                  // also navigate away.
                  const options = (n.response_options ?? []) as unknown as ResponseOption[];
                  const canRespond = options.length > 0 && !n.responded_at;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-2 px-4 py-3 text-left text-sm hover:bg-charcoal-ink/[0.03] dark:hover:bg-night-ink/10",
                          n.status === "pending" && "bg-brand-green/[0.04]"
                        )}
                      >
                        {n.status === "pending" && (
                          <span
                            aria-hidden
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              tier.className
                            )}
                          >
                            {tier.label}
                          </span>
                          <span className="block text-charcoal-ink dark:text-night-ink">{text}</span>
                          <span className="mt-0.5 block text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
                      {canRespond && (
                        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                          {options.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              disabled={respond.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                respond.mutate(
                                  { id: n.id, value: o.value },
                                  {
                                    onSuccess: (result) => {
                                      if (result.redirect) {
                                        setOpen(false);
                                        router.push(result.redirect);
                                      }
                                    },
                                  },
                                );
                              }}
                              className="rounded-full border border-charcoal-ink/15 px-2.5 py-1 text-xs font-medium text-charcoal-ink hover:border-brand-green hover:text-brand-green disabled:opacity-50 dark:border-night-ink/20 dark:text-night-ink dark:hover:text-brand-green-bright"
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {n.responded_at && options.length > 0 && (
                        <p className="px-4 pb-3 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                          You responded: {options.find((o) => o.value === n.response_value)?.label ?? n.response_value}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
