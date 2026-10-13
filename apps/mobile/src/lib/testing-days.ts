import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Testing days for Members (the Care flow). Mirrors apps/web/src/lib/testing-days/model.ts and the patient page: every rule lives in
 * the database functions (membership, capacity, waitlist, one place at a time), so this file only calls them and words the errors.
 */

export type TestingDay = {
  id: string;
  event_date: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string;
  address: string;
  city: string;
  lga: string | null;
  state: string | null;
  seats_left: number;
  full: boolean;
  my_booking_id: string | null;
  my_state: string | null;
};

export type MyTestingBooking = {
  booking_id: string;
  state: "confirmed" | "waitlisted" | "cancelled" | "checked_in" | "no_show";
  kind: "public_day" | "employer_visit";
  event_id: string;
  event_date: string;
  starts_at: string | null;
  venue_name: string;
  address: string;
  city: string;
  event_status: string;
  waitlist_position: number | null;
};

export type PocReleased = {
  results: { id: string; kind: "urinalysis" | "hba1c"; released_at: string | null; items: { analyte_code: string; value_numeric: number | null; value_text: string | null; unit: string; flag: string }[] | null }[];
  ecgs: { id: string; interpreted_at: string | null; interpretation_class: "normal" | "abnormal" | "urgent" | null; interpretation: string | null }[];
};

const ERROR_TEXT: Record<string, string> = {
  membership_required: "Testing days are part of Membership.",
  testing_day_not_available: "That day is no longer available.",
  already_booked_use_reschedule: "You already hold a place. Use Change day to move it.",
  new_day_full_keep_current: "That day is full, so we kept your current place.",
  booking_not_found: "We could not find that booking.",
  booking_not_cancellable: "That booking can no longer be changed.",
  same_day: "That is the day you already hold.",
};

/** A short database code becomes a sentence; an unknown message is never shown raw. */
export function testingDayErrorText(message: string | null | undefined): string {
  return ERROR_TEXT[(message ?? "").trim()] ?? "Something went wrong. Please try again.";
}

export type TestingDaysLoad = { days: TestingDay[]; notMember: boolean };

export async function loadTestingDays(): Promise<QueryResult<TestingDaysLoad>> {
  const { data, error } = await supabase.rpc("list_testing_days", {});
  if (error) {
    if (error.message === "membership_required") return { ok: true, data: { days: [], notMember: true } };
    return { ok: false, error: testingDayErrorText(error.message) };
  }
  return { ok: true, data: { days: (data ?? []) as unknown as TestingDay[], notMember: false } };
}

export async function loadMyTestingBookings(): Promise<QueryResult<MyTestingBooking[]>> {
  const { data, error } = await supabase.rpc("my_testing_bookings");
  if (error) return { ok: false, error: testingDayErrorText(error.message) };
  return { ok: true, data: (data ?? []) as unknown as MyTestingBooking[] };
}

export async function loadReleasedPocResults(): Promise<QueryResult<PocReleased>> {
  const { data, error } = await supabase.rpc("my_poc_results");
  if (error) return { ok: false, error: testingDayErrorText(error.message) };
  return { ok: true, data: (data ?? { results: [], ecgs: [] }) as unknown as PocReleased };
}

export async function bookTestingDay(eventId: string): Promise<QueryResult<{ state: string }>> {
  const { data, error } = await supabase.rpc("book_testing_day", { p_event: eventId });
  if (error) return { ok: false, error: testingDayErrorText(error.message) };
  return { ok: true, data: { state: String((data as { state?: string } | null)?.state ?? "confirmed") } };
}

export async function cancelTestingBooking(bookingId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("cancel_testing_booking", { p_booking: bookingId });
  if (error) return { ok: false, error: testingDayErrorText(error.message) };
  return { ok: true, data: null };
}

export async function rescheduleTestingBooking(bookingId: string, eventId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("reschedule_testing_booking", { p_booking: bookingId, p_new_event: eventId });
  if (error) return { ok: false, error: testingDayErrorText(error.message) };
  return { ok: true, data: null };
}

export function seatsLabel(day: Pick<TestingDay, "seats_left" | "full">): string {
  if (day.full) return "Full: join the waiting list";
  return day.seats_left === 1 ? "1 place left" : `${day.seats_left} places left`;
}
