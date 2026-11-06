import Link from "next/link";
import { formatPatientDateTime } from "@/lib/format-date";
import type { HomeOverview } from "@/lib/patient/home-overview";

/**
 * "Where am I" in one row (patient dashboard 2.0, spec 4.2; PD-05): actions due, results waiting for a doctor, the next
 * consultation, and a care-team reply not yet read. Only real counts: an item whose read failed is left out, never shown as 0.
 * No composite score (T2-06).
 */
export function HomeStatusStrip({ overview }: { overview: HomeOverview }) {
  const items: { key: string; text: string; href: string }[] = [];

  if (overview.actionsDue !== null) {
    items.push({
      key: "actions",
      text: overview.actionsDue === 0 ? "Nothing due today" : `${overview.actionsDue} ${overview.actionsDue === 1 ? "action" : "actions"} due`,
      href: "/patient/actions",
    });
  }
  if (overview.resultsAwaitingDoctor !== null && overview.resultsAwaitingDoctor > 0) {
    items.push({
      key: "results",
      text: `${overview.resultsAwaitingDoctor} ${overview.resultsAwaitingDoctor === 1 ? "result" : "results"} waiting for a doctor`,
      href: "/patient/health-records",
    });
  }
  if (overview.nextAppointment) {
    items.push({
      key: "appointment",
      text: `Next appointment ${formatPatientDateTime(overview.nextAppointment.scheduledFor, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      href: "/patient/appointments",
    });
  }
  if (overview.unreadCareTeamReply === true) {
    items.push({ key: "reply", text: "New reply from your care team", href: "/patient/messages" });
  }

  if (items.length === 0) return null;

  return (
    <nav aria-label="Your health at a glance">
      <ul className="flex flex-wrap gap-2" data-testid="home-status-strip">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-full border border-charcoal-ink/10 bg-white px-4 text-sm font-medium tabular-nums text-charcoal-ink hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:border-night-ink/15 dark:bg-night-card dark:text-night-ink"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
