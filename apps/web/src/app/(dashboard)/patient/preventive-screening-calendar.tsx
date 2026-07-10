"use client";

import { useScreeningSchedules } from "@/lib/queries/screening";
import { todayIsoDate } from "@/lib/queries/medications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Pending" },
  booked: { variant: "blue", label: "Booked" },
  completed: { variant: "green", label: "Completed" },
  overdue: { variant: "red", label: "Overdue" },
};

export function PreventiveScreeningCalendar({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useScreeningSchedules(patientId);
  const today = todayIsoDate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Preventive screening calendar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your screening calendar.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No screenings scheduled yet. Your care team will schedule preventive screenings
            based on your age, sex, and risk profile.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((schedule) => {
              const isOverdue =
                schedule.due_date < today &&
                (schedule.status === "pending" || schedule.status === "booked");
              const badge = STATUS_BADGE[isOverdue ? "overdue" : schedule.status] ??
                STATUS_BADGE.pending;

              return (
                <li key={schedule.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {schedule.screen_type?.name ?? "Screening"}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    Due {new Date(schedule.due_date).toLocaleDateString()}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
