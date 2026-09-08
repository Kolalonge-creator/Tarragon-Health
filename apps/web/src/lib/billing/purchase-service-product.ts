"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { initiateServicePurchaseCheckout } from "@/lib/billing/service-purchase-checkout";
import type { Database } from "@tarragon/shared";

export type PurchaseServiceProductState =
  | { error?: string; checkoutUrl?: string; activated?: boolean }
  | undefined;

/**
 * Generic pay-per-service purchase entry point — buys any service_products
 * row for the caller (or, if patientId differs, a patient the caller has
 * org-staff/sponsor authority over, enforced by record_service_purchase_intent
 * itself). Used both for the tier packs (prevent_pack/essential_pack/etc,
 * apps/web/src/app/(dashboard)/patient/subscription) and the 12-week
 * chronic-care doctor-supported add-on (chronic_doctor_supported_pack,
 * scoped to a specific chronic_programme_enrolments row via
 * scopedEntityType/scopedEntityId) — the same checkout path, just a
 * different product code and optional scope.
 *
 * `client`/`caller`/`callbackUrl` are the mobile seam: the Expo app has no
 * Next.js cookie session and no `origin` header to build a same-site
 * callback path from, so /api/mobile/services/checkout resolves the caller
 * from its own bearer token and passes a bearer-authenticated client, the
 * already-verified user, and a full `tarragonhealth://` deep-link callback
 * URL instead. Every existing web call site omits all three and keeps
 * today's cookie-based auth + relative callbackPath behaviour unchanged.
 */
export async function purchaseServiceProduct(args: {
  serviceProductCode: string;
  patientId?: string;
  scopedEntityType?: string;
  scopedEntityId?: string;
  callbackPath: string;
  callbackUrl?: string;
  promoCode?: string;
  client?: SupabaseClient<Database>;
  caller?: { id: string; email: string };
}): Promise<PurchaseServiceProductState> {
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
      return { error: "Your account has no email on file — add one before purchasing." };
    }
    userId = user.id;
    userEmail = user.email;
  }

  const patientId = args.patientId ?? userId;

  const { data: purchaseId, error: intentError } = await supabase.rpc(
    "record_service_purchase_intent",
    {
      p_patient_id: patientId,
      p_service_product_code: args.serviceProductCode,
      p_scoped_entity_type: args.scopedEntityType,
      p_scoped_entity_id: args.scopedEntityId,
    },
  );
  if (intentError || !purchaseId) {
    return { error: intentError?.message ?? "Could not start this purchase" };
  }

  // Applied before loading the row below so payable_kobo (a generated
  // column, amount_kobo minus whatever the promo/voucher covered) already
  // reflects the discount by the time checkout reads it. A failed code
  // surfaces as an error without abandoning the purchase — the pending row
  // stays put, same as any other unpaid intent, and the patient can retry.
  if (args.promoCode?.trim()) {
    const { error: promoError } = await supabase.rpc("redeem_promo_code", {
      p_code: args.promoCode.trim(),
      p_order_type: "service_purchase",
      p_order_id: purchaseId,
    });
    if (promoError) {
      return { error: promoError.message };
    }
  }

  const { data: purchase, error: loadError } = await supabase
    .from("service_purchases")
    .select(
      "id, organisation_id, patient_id, payable_kobo, currency, status, service_product:service_products(code, name)",
    )
    .eq("id", purchaseId)
    .single();
  if (loadError || !purchase) {
    return { error: loadError?.message ?? "Could not load the purchase you just started" };
  }

  // record_service_purchase_intent activates a free product immediately, and
  // a promo/voucher that fully covers the price activates it too (see
  // redeem_care_voucher's service_purchase branch) — either way there's no
  // charge left to run.
  if (purchase.status === "active") {
    return { activated: true };
  }
  if (purchase.payable_kobo === null) {
    return { error: "This purchase has no amount to charge — contact support." };
  }

  const callbackUrl =
    args.callbackUrl ?? `${(await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? ""}${args.callbackPath}`;
  const productName = purchase.service_product?.name ?? args.serviceProductCode;

  const result = await initiateServicePurchaseCheckout({
    servicePurchaseId: purchase.id,
    serviceProductCode: args.serviceProductCode,
    organisationId: purchase.organisation_id,
    patientId: purchase.patient_id,
    amountKobo: purchase.payable_kobo,
    currency: purchase.currency,
    email: userEmail,
    description: productName,
    callbackUrl,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  return { checkoutUrl: result.checkoutUrl };
}
