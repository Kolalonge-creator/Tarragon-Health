import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { testingDayListSchema, myBookingListSchema } from "@/lib/testing-days/model";
import { appointmentLabel, readMyAppointments } from "@/lib/calendar/bookings";
import {
  buildCalendarEntries,
  ENTRY_KIND_LABEL,
  groupByMonth,
  lagosDate,
  MONTHS,
  parseYear,
  yearRange,
  type CalendarEntry,
  type CalendarEntryKind,
} from "@/lib/calendar/patient-calendar";

export const metadata = { title: "My calendar" };

const KIND_BADGE: Record<CalendarEntryKind, BadgeProps["variant"]> = {
  appointment: "blue",
  testing_booked: "green",
  testing_open: "grey",
  screening: "amber",
};

const screeningRowSchema = z.object({
  id: z.string().uuid(),
  due_date: z.string().nullable(),
  status: z.string(),
  screen_type: z.object({ name: z.string() }).nullable(),
});

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
}

function Entry({ e }: { e: CalendarEntry }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {dayLabel(e.date)}
          {e.time ? `, ${e.time}` : ""}: {e.title}
        </p>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{e.detail}</p>
        <Badge variant={KIND_BADGE[e.kind]}>{ENTRY_KIND_LABEL[e.kind]}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={e.href}>{e.kind === "testing_open" ? "Book" : "Open"}</Link>
        </Button>
        {e.icsHref ? (
          <Button asChild size="sm" variant="ghost">
            <a href={e.icsHref}>Add to calendar</a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One place for the patient's year: booked consultations, testing-day places, testing days still open to book and
 * screenings that are due. Every read is on the patient's own session. A source that fails to load is named on the
 * page, never silently left out, so an empty month is never mistaken for "nothing booked".
 */
export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  const thisYear = Number(lagosDate(new Date().toISOString()).slice(0, 4));
  const { year: yearParam } = await searchParams;
  const year = parseYear(yearParam, thisYear);
  const range = yearRange(thisYear);
  const supabase = await createClient();
  const failed: string[] = [];

  const [appointmentsResult, bookingsResult, daysResult, screeningsResult] = await Promise.all([
    readMyAppointments(
      supabase,
      profile.id,
      // a day either side so a visit just after midnight Lagos time is not lost at the year edge
      { from: `${year - 1}-12-31T00:00:00Z`, to: `${year + 1}-01-02T00:00:00Z` },
      ["booked", "confirmed", "checked_in", "in_progress", "completed"],
    ).then(
      (rows) => rows,
      () => null,
    ),
    supabase.rpc("my_testing_bookings"),
    supabase.rpc("list_testing_days", {}),
    supabase
      .from("screening_schedules")
      .select("id, due_date, status, screen_type:screen_types(name)")
      .eq("patient_id", profile.id)
      .gte("due_date", `${year}-01-01`)
      .lte("due_date", `${year}-12-31`),
  ]);

  if (appointmentsResult === null) failed.push("consultations");
  // A read error AND a reply in an unexpected shape both count as "could not load", never as an empty list.
  function rows<T>(label: string, schema: z.ZodType<T[]>, result: { data: unknown; error: unknown }): T[] {
    const parsed = result.error ? null : schema.safeParse(result.data ?? []);
    if (!parsed?.success) {
      failed.push(label);
      return [];
    }
    return parsed.data;
  }
  const bookings = rows("testing-day bookings", myBookingListSchema, bookingsResult);
  // Free accounts are refused open days (membership_required); that is not a failure, they simply have none to book.
  const openDays =
    daysResult.error?.message === "membership_required" ? [] : rows("open testing days", testingDayListSchema, daysResult);
  const screenings = rows("screenings", z.array(screeningRowSchema), screeningsResult);

  const entries = buildCalendarEntries(
    {
      appointments: (appointmentsResult ?? []).map((a) => ({
        id: a.id,
        scheduled_for: a.scheduled_for,
        ends_at: a.ends_at,
        status: a.status,
        label: appointmentLabel(a.appointment_type),
        clinicianName: a.clinician?.full_name ?? null,
      })),
      testingBookings: bookings,
      openDays,
      screenings: screenings.map((s) => ({ id: s.id, due_date: s.due_date, status: s.status, name: s.screen_type?.name ?? "Screening" })),
    },
    year,
  );
  const months = groupByMonth(entries);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="My calendar"
        icon={SEMANTIC_ICON.preventive}
        description="Your consultations, testing days and screenings for the year, with testing days you can still book."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Choose a year" className="flex items-center gap-2">
          {year - 1 >= range.min ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/patient/calendar?year=${year - 1}`}>{year - 1}</Link>
            </Button>
          ) : null}
          <span className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">{year}</span>
          {year + 1 <= range.max ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/patient/calendar?year=${year + 1}`}>{year + 1}</Link>
            </Button>
          ) : null}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/patient/appointments">Book a consultation</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/patient/testing-days">Book a testing day</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href="/api/calendar/mine">Add all my bookings to my calendar</a>
          </Button>
        </div>
      </div>

      {failed.length > 0 ? (
        <p role="alert" className="text-sm text-status-red">
          We could not load your {failed.join(", ")} just now, so this calendar may be missing something. Please refresh to try again.
        </p>
      ) : null}

      <ol aria-label={`${year} at a glance`} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {months.map((m, i) => (
          <li key={MONTHS[i]}>
            <a
              href={`#month-${i + 1}`}
              className="block rounded-md border border-charcoal-ink/10 p-2 text-center text-xs text-charcoal-ink dark:border-night-ink/15 dark:text-night-ink"
            >
              <span className="block font-medium">{MONTHS[i]!.slice(0, 3)}</span>
              <span className="text-charcoal-ink/60 dark:text-night-ink/60">{m.length === 0 ? "Nothing" : `${m.length} item${m.length === 1 ? "" : "s"}`}</span>
            </a>
          </li>
        ))}
      </ol>

      {entries.length === 0 && failed.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing in {year} yet. Book a consultation or a testing day and it will appear here.</p>
      ) : null}

      {months.map((m, i) =>
        m.length === 0 ? null : (
          <Card key={MONTHS[i]} id={`month-${i + 1}`}>
            <CardHeader>
              <CardTitle>
                {MONTHS[i]} {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {m.map((e) => (
                  <Entry key={e.id} e={e} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
