import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON, APP_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  resolveActionCentreItems,
  bucketActionItems,
  daysLabel,
  type ActionItem,
} from "./actions-data";

/** Shared list rendering for every bucket below — same icon + type label +
 * title-as-Link + trailing days shape as CareScheduleCard's list items, so
 * the Action Centre reads as the same design system, just the full list
 * instead of the nearest-one summary. */
function ActionList({ items }: { items: ActionItem[] }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ul className="divide-y divide-charcoal-ink/10">
      {items.map((item, i) => {
        const Icon = APP_ICON[item.icon] ?? SEMANTIC_ICON.carePlan;
        const isOverdue = item.dueDate !== null && item.dueDate < today;
        return (
          <li key={i} className="flex items-start gap-3 py-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-ink/50" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
                {item.type}
              </p>
              <Link href={item.href} className="text-sm text-charcoal-ink hover:underline">
                {item.title}
              </Link>
            </div>
            {item.dueDate ? (
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap text-xs",
                  isOverdue ? "font-medium text-red-700" : "text-charcoal-ink/50"
                )}
              >
                {daysLabel(item.dueDate)}
              </span>
            ) : (
              <Badge variant="amber" className="shrink-0">
                Awaiting you
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Action Centre — spec §76.5. Every outstanding task in one place,
 * grouped High priority / Due today / Due this week / Upcoming, instead of
 * scattered across the separate dashboard cards the way Overview shows them
 * today. Overview's own "next best step" hero (next-best-action.tsx) stays
 * exactly as it is; this page is the full list behind it, reachable from the
 * "My actions" nav entry.
 */
export default async function PatientActionsPage() {
  const { subjectId } = await getPatientDashboardContext();
  const items = await resolveActionCentreItems(subjectId);
  const buckets = bucketActionItems(items);

  const isFullyEmpty =
    buckets.highPriority.length === 0 &&
    buckets.dueToday.length === 0 &&
    buckets.dueThisWeek.length === 0 &&
    buckets.upcoming.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">My actions</h1>
        <p className="text-sm text-charcoal-ink/60">
          Everything outstanding, in one place, grouped by how soon it needs you.
        </p>
      </div>

      {isFullyEmpty && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <SEMANTIC_ICON.preventive className="h-5 w-5 shrink-0 text-brand-green" strokeWidth={2} />
            <p className="text-sm text-charcoal-ink/70">
              You&apos;re all caught up. Nothing outstanding right now. Keep logging readings and
              we&apos;ll flag anything that needs your attention.
            </p>
          </CardContent>
        </Card>
      )}

      {buckets.highPriority.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-800">
              <SEMANTIC_ICON.escalation className="h-5 w-5" strokeWidth={2} />
              High priority
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionList items={buckets.highPriority} />
          </CardContent>
        </Card>
      )}

      {/* Due today always renders — Today's doses is the one working,
          separately-fetched piece of "due today" that already exists, so it
          composes here rather than being re-derived into the merged list. */}
      <div className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Due today</h2>
        <TodaysDoses patientId={subjectId} />
        {buckets.dueToday.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <ActionList items={buckets.dueToday} />
            </CardContent>
          </Card>
        )}
      </div>

      {buckets.dueThisWeek.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Due this week</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionList items={buckets.dueThisWeek} />
          </CardContent>
        </Card>
      )}

      {buckets.upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionList items={buckets.upcoming} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
