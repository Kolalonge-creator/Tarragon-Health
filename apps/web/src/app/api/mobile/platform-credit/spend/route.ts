import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";

/**
 * Mobile equivalent of apps/web/src/lib/queries/platform-credit.ts's
 * usePayServicePurchaseWithCredit — same two-RPC shape
 * (record_service_purchase_intent, then pay_service_purchase_on_platform_credit),
 * just reached over HTTPS from the Expo app with a bearer token instead of
 * the Supabase JS client directly (same pattern as the balance/topup-intent
 * passthrough routes next to this one). No service-role client anywhere
 * here — both RPCs are SECURITY DEFINER but check auth.uid()/RLS themselves,
 * so this route can only ever spend the caller's own balance (or, same as
 * the RPCs' own authority check, a linked dependent's on the caller's
 * behalf — patientId defaults to the caller's own id).
 *
 * This is what lets every mobile "pay with Platform Credit in-app" screen
 * (the five credit-gated ones, My services, the stalled-purchase retry
 * card) settle a request's credit without bouncing out to the browser:
 * record_service_purchase_intent creates the pending service_purchases row
 * for the product the caller names, and pay_service_purchase_on_platform_
 * credit either activates it from the patient's platform_credit balance or
 * comes back with a reason: "insufficient_balance" shortfall the caller can
 * show — the exact same jsonb shape usePayServicePurchaseWithCredit's
 * callers already handle on web, just spread flat into this route's JSON
 * body (`{ success: true, ...result }`) instead of an RPC result.
 *
 * scopedEntityType/scopedEntityId are accepted (mirroring
 * record_service_purchase_intent's own optional params) but no caller needs
 * them today — each spends a plain, unscoped product credit that a later
 * insert (second_opinion_requests, async_consults, etc.) redeems via
 * redeem_available_service_purchase, not something tied to the purchase row
 * itself.
 */
const bodySchema = z.object({
  serviceProductCode: z.string().min(1),
  patientId: z.string().uuid().optional(),
  scopedEntityType: z.string().min(1).optional(),
  scopedEntityId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const patientId = parsed.data.patientId ?? user.id;

  const { data: purchaseId, error: intentError } = await supabase.rpc(
    "record_service_purchase_intent",
    {
      p_patient_id: patientId,
      p_service_product_code: parsed.data.serviceProductCode,
      p_scoped_entity_type: parsed.data.scopedEntityType,
      p_scoped_entity_id: parsed.data.scopedEntityId,
    }
  );
  if (intentError || !purchaseId) {
    return NextResponse.json(
      { error: intentError?.message ?? "Could not start this purchase" },
      { status: 400 }
    );
  }

  const { data: result, error: payError } = await supabase.rpc(
    "pay_service_purchase_on_platform_credit",
    { p_service_purchase_id: purchaseId }
  );
  if (payError) {
    return NextResponse.json({ error: payError.message }, { status: 400 });
  }

  // result is the same jsonb PayWithCreditResult shape
  // usePayServicePurchaseWithCredit returns on web — e.g.
  // { ok: true, service_purchase_id, amount_kobo, new_balance_kobo } or
  // { ok: false, reason: "insufficient_balance", balance_kobo, required_kobo, shortfall_kobo }.
  return NextResponse.json({ success: true, ...(result as Record<string, unknown>) });
}
