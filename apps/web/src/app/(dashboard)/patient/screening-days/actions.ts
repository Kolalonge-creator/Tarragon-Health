"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { initiateScreeningDayPaymentCheckout } from "@/lib/billing/screening-day-checkout";
import { nairaToKobo } from "@tarragon/shared";
import type { Currency } from "@tarragon/shared";

export type ScreeningDayActionState = { error?: string; message?: string } | undefined;

/**
 * The self-serve half of "bring your church, market association, or SME and
 * get a discounted rate" — see
 * supabase/migrations/20260829164213_group_screening_days.sql. Anyone
 * authenticated can request one; staff review and confirm it with a real
 * discounted price before it can be paid for.
 */
export async function requestScreeningDay(
  _prevState: ScreeningDayActionState,
  formData: FormData,
): Promise<ScreeningDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const hostName = (formData.get("hostName") as string) || "";
  const contactPhone = (formData.get("contactPhone") as string) || "";
  const location = (formData.get("location") as string) || "";
  const eventDate = (formData.get("eventDate") as string) || "";
  const panelBundleId = (formData.get("panelBundleId") as string) || "";
  const slotsRequested = Number(formData.get("slotsRequested"));
  const notes = (formData.get("notes") as string) || "";

  if (!hostName.trim()) return { error: "Who is this screening day for?" };
  if (!location.trim()) return { error: "Where will this happen?" };
  if (!eventDate) return { error: "When is it happening?" };
  if (!panelBundleId) return { error: "Choose which check you'd like people to have." };
  if (!Number.isFinite(slotsRequested) || slotsRequested <= 0) {
    return { error: "How many people are coming?" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_screening_day", {
    p_host_name: hostName,
    p_contact_phone: contactPhone,
    p_location: location,
    p_event_date: eventDate,
    p_panel_bundle_id: panelBundleId,
    p_slots_requested: slotsRequested,
    p_notes: notes || undefined,
  });

  if (error) return { error: error.message };

  return {
    message: "Request sent. We'll confirm the discounted price and get back to you before anyone needs to pay.",
  };
}

/**
 * Pays some or all of what is outstanding on a confirmed screening day —
 * the one payer covering the whole cohort upfront. Layaway against a named
 * event, same shape as payTowardVoucher.
 */
export async function payTowardScreeningDay(
  _prevState: ScreeningDayActionState,
  formData: FormData,
): Promise<ScreeningDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const screeningDayId = formData.get("screeningDayId") as string;
  const amountNaira = Number(formData.get("amountNaira"));
  const currency = (formData.get("currency") as Currency) || "NGN";

  if (!screeningDayId) return { error: "Which screening day are you paying for?" };
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    return { error: "Enter how much you'd like to pay." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateScreeningDayPaymentCheckout({
    screeningDayId,
    creditKobo: nairaToKobo(amountNaira),
    payerCurrency: currency,
    email: user.email,
    callbackUrl: `${origin}/patient/screening-days`,
    description: "Group screening day payment",
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}

/** Registers one attendee ahead of time or on the day — name and phone only, they don't need an account yet. */
export async function addScreeningDaySlot(
  _prevState: ScreeningDayActionState,
  formData: FormData,
): Promise<ScreeningDayActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const screeningDayId = formData.get("screeningDayId") as string;
  const fullName = (formData.get("fullName") as string) || "";
  const phone = (formData.get("phone") as string) || "";

  if (!screeningDayId) return { error: "Which screening day?" };
  if (!fullName.trim()) return { error: "Their name?" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_screening_day_slot", {
    p_screening_day_id: screeningDayId,
    p_full_name: fullName,
    p_phone: phone || undefined,
  });

  if (error) return { error: error.message };
  return { message: `${fullName.trim()} is on the list.` };
}
