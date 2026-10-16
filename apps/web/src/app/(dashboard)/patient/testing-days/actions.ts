"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { testingDayErrorText } from "@/lib/testing-days/model";

export type TestingDayActionState = { error?: string; message?: string } | undefined;

const eventSchema = z.object({ eventId: z.string().uuid() });
const bookingSchema = z.object({ bookingId: z.string().uuid() });
const rescheduleSchema = z.object({ bookingId: z.string().uuid(), eventId: z.string().uuid() });

/** Hold a place on a testing day. Members only: the database refuses anyone else with `membership_required`. */
export async function bookTestingDay(_prev: TestingDayActionState, formData: FormData): Promise<TestingDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const parsed = eventSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please choose a day." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_testing_day", { p_event: parsed.data.eventId });
  if (error) return { error: testingDayErrorText(error.message) };
  revalidatePath("/patient/testing-days");
  const state = (data as { state?: string } | null)?.state;
  return {
    message: state === "waitlisted" ? "The day is full. You are on the waiting list and we will tell you if a place opens." : "Your place is held.",
  };
}

export async function cancelTestingBooking(_prev: TestingDayActionState, formData: FormData): Promise<TestingDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "We could not find that booking." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_testing_booking", { p_booking: parsed.data.bookingId });
  if (error) return { error: testingDayErrorText(error.message) };
  revalidatePath("/patient/testing-days");
  return { message: "Your booking is cancelled." };
}

/** Move to another day. If the new day is full the database keeps the current place and says so. */
export async function rescheduleTestingBooking(_prev: TestingDayActionState, formData: FormData): Promise<TestingDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please choose a day." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_testing_booking", {
    p_booking: parsed.data.bookingId,
    p_new_event: parsed.data.eventId,
  });
  if (error) return { error: testingDayErrorText(error.message) };
  revalidatePath("/patient/testing-days");
  return { message: "Your place is moved." };
}
