"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  BOOKING_STATE_LABEL,
  filterDaysByPlace,
  hoursLabel,
  mapLink,
  placeOptions,
  seatsLabel,
  type MyBooking,
  type TestingDay,
} from "@/lib/testing-days/model";
import { cancelTestingBooking, rescheduleTestingBooking, type TestingDayActionState } from "./actions";

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function Directions({ text, mapHref }: { text: string | null | undefined; mapHref: string }) {
  return (
    <div className="space-y-1 text-sm text-charcoal-ink/70">
      {text ? <p>Directions: {text}</p> : null}
      <a href={mapHref} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-green underline">
        Open in maps
      </a>
    </div>
  );
}

/** A GET form, so the chosen place is in the address and survives a refresh or a shared link. */
function PlaceFilter({ days, place }: { days: TestingDay[]; place: { state: string; city: string } }) {
  const { states, cities } = placeOptions(days);
  // Nothing to choose between, unless a filter from the address is active: then it must stay visible so it can be cleared.
  if (states.length + cities.length <= 1 && !place.state && !place.city) return null;
  return (
    <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Find a testing day near you">
      {states.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="td-state">State</Label>
          <Select id="td-state" name="state" defaultValue={place.state}>
            <option value="">Every state</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="td-city">City</Label>
        <Select id="td-city" name="city" defaultValue={place.city}>
          <option value="">Every city</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline">
        Show days
      </Button>
    </form>
  );
}

function Feedback({ state }: { state: TestingDayActionState }) {
  if (!state) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={state.error ? "text-sm text-status-red" : "text-sm text-brand-green"}>
      {state.error ?? state.message}
    </p>
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

export function TestingDaysPanel({
  days,
  bookings,
  place = { state: "", city: "" },
}: {
  days: TestingDay[];
  bookings: MyBooking[];
  place?: { state: string; city: string };
}) {
  const live = bookings.find((b) => b.state === "confirmed" || b.state === "waitlisted");
  const others = filterDaysByPlace(
    days.filter((d) => d.my_state === null),
    place,
  );
  const filtered = Boolean(place.state || place.city);

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
              {hoursLabel(live.starts_at, live.ends_at) ? `, ${hoursLabel(live.starts_at, live.ends_at)}` : ""}
            </p>
            <p className="text-sm text-charcoal-ink/70">
              {live.venue_name}, {live.address}, {live.city}
              {live.state_name ? `, ${live.state_name}` : ""}
            </p>
            <Directions
              text={live.directions}
              mapHref={mapLink({ venue_name: live.venue_name, address: live.address, city: live.city, state: live.state_name })}
            />
            {live.state === "confirmed" ? (
              <a href={`/api/calendar/testing/${live.booking_id}`} className="inline-block text-sm font-medium text-brand-green underline">
                Add to my calendar
              </a>
            ) : null}
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

      {/* T2-02: no new bookings. Someone who already holds a place may move it to another day that is still scheduled. */}
      {live ? (
        <section aria-labelledby="upcoming-days" className="space-y-3">
          <h2 id="upcoming-days" className="font-heading text-lg font-semibold text-charcoal-ink">
            Move your place to another day
          </h2>
          <PlaceFilter days={days.filter((d) => d.my_state === null)} place={place} />
          {others.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {filtered ? "No other days in that place. Try another state or city." : "There are no other days to move to."}
            </p>
          ) : (
            others.map((d) => (
              <Card key={d.id}>
                <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium text-charcoal-ink">
                      {dateLabel(d.event_date)}
                      {hoursLabel(d.starts_at, d.ends_at) ? `, ${hoursLabel(d.starts_at, d.ends_at)}` : ""}
                    </p>
                    <p className="text-sm text-charcoal-ink/70">
                      {d.venue_name}, {d.address}, {d.city}
                      {d.lga ? ` (${d.lga})` : ""}
                      {d.state ? `, ${d.state}` : ""}
                    </p>
                    <Directions text={d.directions} mapHref={mapLink(d)} />
                    <p className="text-xs text-charcoal-ink/60">{seatsLabel(d)}</p>
                  </div>
                  <MoveForm booking={live} day={d} />
                </CardContent>
              </Card>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
