"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BOOKING_STATE_LABEL, seatsLabel, type MyBooking, type TestingDay } from "@/lib/testing-days/model";
import { bookTestingDay, cancelTestingBooking, rescheduleTestingBooking, type TestingDayActionState } from "./actions";

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function timeLabel(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

function Feedback({ state }: { state: TestingDayActionState }) {
  if (!state) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={state.error ? "text-sm text-status-red" : "text-sm text-brand-green"}>
      {state.error ?? state.message}
    </p>
  );
}

function BookForm({ day, label }: { day: TestingDay; label: string }) {
  const [state, action, pending] = useActionState(bookTestingDay, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={day.id} />
      <Button type="submit" disabled={pending}>
        {pending ? "Working..." : label}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function MoveForm({ booking, day }: { booking: MyBooking; day: TestingDay }) {
  const [state, action, pending] = useActionState(rescheduleTestingBooking, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bookingId" value={booking.booking_id} />
      <input type="hidden" name="eventId" value={day.id} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Working..." : "Change to this day"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function CancelForm({ booking }: { booking: MyBooking }) {
  const [state, action, pending] = useActionState(cancelTestingBooking, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bookingId" value={booking.booking_id} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Working..." : "Cancel my place"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function TestingDaysPanel({ days, bookings }: { days: TestingDay[]; bookings: MyBooking[] }) {
  const live = bookings.find((b) => b.state === "confirmed" || b.state === "waitlisted");
  const others = days.filter((d) => d.my_state === null);

  return (
    <div className="space-y-6">
      {live ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Your place <Badge variant={live.state === "confirmed" ? "green" : "amber"}>{BOOKING_STATE_LABEL[live.state]}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-charcoal-ink">
              {dateLabel(live.event_date)}
              {live.starts_at ? `, from ${timeLabel(live.starts_at)}` : ""}
            </p>
            <p className="text-sm text-charcoal-ink/70">
              {live.venue_name}, {live.address}, {live.city}
            </p>
            {live.state === "waitlisted" && live.waitlist_position ? (
              <p className="text-sm text-charcoal-ink/70">You are number {live.waitlist_position} on the waiting list.</p>
            ) : null}
            <p className="text-xs text-charcoal-ink/60">
              Please arrive on the day and ask for the registration desk. We will remind you a week before and the day before.
            </p>
            <CancelForm booking={live} />
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="upcoming-days" className="space-y-3">
        <h2 id="upcoming-days" className="font-heading text-lg font-semibold text-charcoal-ink">
          {live ? "Other days" : "Upcoming testing days"}
        </h2>
        {others.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No other days are open right now. Please check back soon.</p>
        ) : (
          others.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="font-medium text-charcoal-ink">{dateLabel(d.event_date)}</p>
                  <p className="text-sm text-charcoal-ink/70">
                    {d.venue_name}, {d.address}, {d.city}
                    {d.lga ? ` (${d.lga})` : ""}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">{seatsLabel(d)}</p>
                </div>
                {live ? <MoveForm booking={live} day={d} /> : <BookForm day={d} label={d.full ? "Join waiting list" : "Hold my place"} />}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
