"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { APPOINTMENT_VIEWS, type AppointmentViewId, type AppointmentHistoryView } from "@/lib/appointments/appointment-views";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MyAppointmentsList } from "./my-appointments-list";
import { AppointmentHistoryList } from "./appointment-history-list";
import type { Locale } from "@tarragon/i18n";

const HISTORY_TITLE: Record<AppointmentHistoryView, string> = {
  past: "Past appointments",
  cancelled: "Cancelled appointments",
  missed: "Missed appointments",
};

/**
 * P15: Upcoming / Past / Cancelled / Missed, as filter chips in the same pattern as the timeline page (timeline-client.tsx,
 * aria-pressed). Upcoming is the existing list in its existing place; the other three read history.
 */
export function AppointmentsViews({ patientId, isSelf, locale = "en" }: { patientId: string; isSelf: boolean; locale?: Locale }) {
  const [view, setView] = useState<AppointmentViewId>("upcoming");
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Show appointments" className="flex flex-wrap gap-2">
        {APPOINTMENT_VIEWS.map((option) => {
          const active = option.id === view;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setView(option.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                active
                  ? "border-brand-green bg-brand-green text-white dark:border-brand-green-bright dark:bg-brand-green-bright dark:text-night-ground"
                  : "border-charcoal-ink/15 bg-white text-charcoal-ink hover:border-brand-green/50 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {view === "upcoming" ? (
        <MyAppointmentsList patientId={patientId} locale={locale} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{HISTORY_TITLE[view]}</CardTitle>
          </CardHeader>
          <CardContent>
            <AppointmentHistoryList patientId={patientId} isSelf={isSelf} view={view} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
