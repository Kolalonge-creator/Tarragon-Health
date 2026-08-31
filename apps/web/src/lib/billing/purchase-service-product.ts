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

  const { data: purchase, error: loadError } = await supabase
    .from("service_purchases")
    .select(
      "id, organisation_id, patient_id, amount_kobo, currency, status, service_product:service_products(code, name)",
    )
    .eq("id", purchaseId)
    .single();
  if (loadError || !purchase) {
    return { error: loadError?.message ?? "Could not load the purchase you just started" };
  }

  // record_service_purchase_intent activates a free product immediately —
  // no charge to run, so no checkout to start.
  if (purchase.status === "active") {
    return { activated: true };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const callbackUrl = `${origin}${args.callbackPath}`;
  const productName = purchase.service_product?.name ?? args.serviceProductCode;

  const result = await initiateServicePurchaseCheckout({
    servicePurchaseId: purchase.id,
    serviceProductCode: args.serviceProductCode,
    organisationId: purchase.organisation_id,
    patientId: purchase.patient_id,
    amountKobo: purchase.amount_kobo,
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
