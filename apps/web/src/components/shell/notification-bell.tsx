"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  useInAppNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type InAppNotification,
} from "@/lib/queries/notifications";

/** Renders each in-app template's payload as a short line + a link to where
 * it's actually acted on. Add a case here for every new in_app template —
 * anything unmapped still shows (generic text, dashboard link) rather than
 * silently disappearing from the bell. */
function describe(n: InAppNotification): { text: string; href: string } {
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  if (n.template === "health_education_unlock") {
    const title = String(payload.lesson_title ?? "a new lesson");
    const count = Number(payload.lesson_count ?? 1);
    return {
      text:
        count > 1
          ? `${count} new lessons ready — starting with "${title}"`
          : `New lesson ready: "${title}"`,
      href: "/patient#prevention",
    };
  }
  if (n.template === "health_reset_complete") {
    return {
      text: "Your 90-Day Health Reset is complete — claim your free trial",
      href: "/patient#overview",
    };
  }
  if (n.template === "care_access_view_request" || n.template === "care_access_manage_request") {
    const name = String(payload.initiator_name ?? "Someone");
    const level = payload.permission_level === "manage" ? "manage" : "view";
    return {
      text: `${name} sent a request to ${level} care — respond in Your people`,
      href: "/patient/family",
    };
  }
  if (n.template === "care_access_request_accepted" || n.template === "care_access_request_declined") {
    const name = String(payload.responder_name ?? "They");
    const accepted = n.template === "care_access_request_accepted";
    return {
      text: `${name} ${accepted ? "accepted" : "declined"} your care access request`,
      href: "/patient/family",
    };
  }
  if (n.template === "sponsor_spend_receipt") {
    // From private.notify_sponsors_of_wallet_spend(). The receipt a person who
    // funded someone else's care gets when that money actually becomes care.
    // Names the service category and the amount, never a result: paying for
    // care and being allowed to read it are separate permissions.
    const name = String(payload.beneficiary_name ?? "Someone you support");
    const what = String(payload.what ?? "care");
    const amount = Number(payload.amount_kobo ?? 0) / 100;
    return {
      text: `₦${amount.toLocaleString("en-NG")} you funded paid for ${what} for ${name}`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "sponsor_monthly_report") {
    // From private.queue_sponsor_monthly_reports(). The standing monthly
    // summary to whoever is paying for someone else's care: money, bills
    // outstanding and whether anything has gone quiet. Never clinical content,
    // for the same reason as the spend receipt above.
    const people = Array.isArray(payload.people) ? payload.people : [];
    const spent = people.reduce(
      (sum: number, person: unknown) =>
        sum + Number((person as Record<string, unknown>)?.spent_kobo ?? 0),
      0
    );
    return {
      text:
        people.length === 0
          ? "Your monthly summary is ready"
          : `Monthly summary: ₦${(spent / 100).toLocaleString("en-NG")} became care across ${people.length} ${people.length === 1 ? "person" : "people"}`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "critical_notification_escalation_exhausted") {
    // From private.escalate_unconfirmed_critical_notifications() —
    // every channel in a critical alert's ladder (push -> whatsapp -> sms)
    // ran out with nobody confirming it. Admin-only visibility surface;
    // the underlying clinical SLA/worklist safety net is unaffected either
    // way, this is purely "a notification chain needs a human look."
    const sourceTable = String(payload.source_table ?? "");
    return {
      text: "A critical alert went unconfirmed on every channel — needs a look",
      href: sourceTable === "clinician_alerts" ? "/doctor/escalations" : "/admin",
    };
  }
  return { text: "You have an update", href: "/patient" };
}

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
        className="relative h-9 w-9 p-0 text-charcoal-ink/60 hover:text-charcoal-ink"
        aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <NAV_ICON.bell className="h-5 w-5" strokeWidth={2} />
        {unread.length > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-semibold text-white"
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-charcoal-ink/10 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-charcoal-ink/10 px-4 py-2.5">
            <p className="text-sm font-semibold text-charcoal-ink">Notifications</p>
            {unread.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-brand-green hover:underline"
                onClick={() => markAllRead.mutate(unread.map((n) => n.id))}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-charcoal-ink/50">
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {items.map((n) => {
                  const { text } = describe(n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-2 px-4 py-3 text-left text-sm hover:bg-charcoal-ink/[0.03]",
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
                          <span className="block text-charcoal-ink">{text}</span>
                          <span className="mt-0.5 block text-xs text-charcoal-ink/50">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
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
