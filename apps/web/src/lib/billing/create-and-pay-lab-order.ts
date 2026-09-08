"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import type { Database } from "@tarragon/shared";

export type CreateAndPayForLabOrderResult = { error?: string; checkoutUrl?: string };

/**
 * Core of createAndPayForPartnerLabOrder (apps/web/.../patient/lab-tests/
 * actions.ts), extracted so a mobile "book & pay" checkout route can call
 * the exact same booking/pricing/checkout-initiation logic instead of
 * reimplementing it a second time — same `client`/`caller`/`callbackUrl`
 * mobile seam purchaseServiceProduct already uses (see its header comment).
 * Every existing web call site omits all three and keeps today's
 * cookie-based auth + relative-origin callback behaviour unchanged. This is
 * deliberately not sexual-health-specific — any self-bookable panel bundle
 * (any future native Labs screen included) can reuse this same function
 * and its mobile route rather than each screen growing its own checkout
 * path.
 */
export async function createAndPayForLabOrder(args: {
  panelBundleId: string;
  providerId?: string | null;
  client?: SupabaseClient<Database>;
  caller?: { id: string; email: string };
  callbackUrl?: string;
}): Promise<CreateAndPayForLabOrderResult> {
  const supabase = args.client ?? (await createClient());

  let userId: string;
  let userEmail: string;
  if (args.caller) {
    userId = args.caller.id;
    userEmail = args.caller.email;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    if (!user.email) {
      return { error: "Your account needs an email on file to check out." };
    }
    userId = user.id;
    userEmail = user.email;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", userId)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account has no organisation on file." };
  }

  const { data: order, error: insertError } = await supabase
    .from("lab_orders")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: userId,
      panel_bundle_id: args.panelBundleId,
      fulfilment: "partner",
      status: "pending_payment",
      ...(args.providerId ? { provider_id: args.providerId } : {}),
    })
    .select("id, payable_kobo, total_kobo, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
    .single();
  if (insertError || !order) {
    return { error: "We couldn't set that review up just now. Please try again." };
  }

  const callbackUrl =
    args.callbackUrl ?? `${(await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? ""}/patient`;

  const result = await initiateBookingCheckout({
    orderType: "lab",
    orderId: order.id,
    organisationId: profile.organisation_id,
    patientId: userId,
    amountKobo: order.payable_kobo ?? order.total_kobo,
    currency: "NGN",
    email: userEmail,
    description: order.panel_bundle?.name ?? "Lab review",
    callbackUrl,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  return { checkoutUrl: result.checkoutUrl };
}
