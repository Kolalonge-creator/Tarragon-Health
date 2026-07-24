"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import type { Currency } from "@tarragon/shared";

const requestSchema = z.object({
  slotId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export type RequestVideoVisitState = { error: string } | undefined;

/**
 * Patient requests a paid video visit for a published slot: a
 * video_visit_requests row is created (amount pinned server-side by the DB
 * trigger from the price book — nothing the client sends sets the price) and
 * the browser is redirected to hosted checkout. The captured payment is HELD:
 * 'payment_confirmed' only puts the request in front of a doctor — the visit
 * is booked exclusively by a doctor accepting it, and a declined/unaccepted
 * request is refunded in full. Capitated org members skip payment but still
 * wait for doctor acceptance like everyone else.
 */
export async function requestVideoVisit(
  _prev: RequestVideoVisitState,
  formData: FormData
): Promise<RequestVideoVisitState> {
  const parsed = requestSchema.safeParse({
    slotId: String(formData.get("slot_id") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: "Pick a time first" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account has no organisation on file." };
  }

  // RLS-visible check that the slot is still open before taking payment.
  const { data: slot } = await supabase
    .from("consult_availability_slots")
    .select("id, slot_start")
    .eq("id", parsed.data.slotId)
    .maybeSingle();
  if (!slot) {
    return { error: "That time is no longer available — pick another slot." };
  }

  const { data: request, error: insertError } = await supabase
    .from("video_visit_requests")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      slot_id: parsed.data.slotId,
      note: parsed.data.note ?? null,
    })
    .select("id, amount_minor, currency")
    .single();
  if (insertError || !request) {
    return { error: insertError?.message ?? "Could not create the request." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "video_visit",
    orderId: request.id,
    organisationId: profile.organisation_id,
    patientId: user.id,
    amountKobo: request.amount_minor,
    currency: request.currency as Currency,
    email: user.email,
    description: "Tarragon Health — video visit with a doctor",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  if (result.capitated) {
    redirect("/patient");
  }
  redirect(result.checkoutUrl);
}

/** Patient withdraws a request that hasn't been paid yet (RLS-enforced). */
export async function cancelVideoVisitRequest(requestId: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("video_visit_requests")
    .delete()
    .eq("id", parsed.data)
    .in("status", ["requested", "pending_payment"]);
}
