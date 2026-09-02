"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateServicePurchaseCheckout } from "@/lib/billing/service-purchase-checkout";

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
 */
export async function purchaseServiceProduct(args: {
  serviceProductCode: string;
  patientId?: string;
  scopedEntityType?: string;
  scopedEntityId?: string;
  callbackPath: string;
  promoCode?: string;
}): Promise<PurchaseServiceProductState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Your account has no email on file — add one before purchasing." };
  }

  const patientId = args.patientId ?? user.id;

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

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const callbackUrl = `${origin}${args.callbackPath}`;
  const productName = purchase.service_product?.name ?? args.serviceProductCode;

  const result = await initiateServicePurchaseCheckout({
    servicePurchaseId: purchase.id,
    serviceProductCode: args.serviceProductCode,
    organisationId: purchase.organisation_id,
    patientId: purchase.patient_id,
    amountKobo: purchase.payable_kobo,
    currency: purchase.currency,
    email: user.email,
    description: productName,
    callbackUrl,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  return { checkoutUrl: result.checkoutUrl };
}
