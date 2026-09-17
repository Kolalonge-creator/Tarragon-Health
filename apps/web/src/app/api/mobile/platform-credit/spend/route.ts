import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";

/**
 * Mobile equivalent of apps/web/src/lib/queries/platform-credit.ts's
 * usePayServicePurchaseWithCredit — same two-RPC shape
 * (record_service_purchase_intent, then pay_service_purchase_on_platform_credit),
 * just returning the RPC's own result JSON instead of driving React Query
 * cache invalidation, since the mobile app manages its own screen state.
 * No service-role client anywhere here — RLS/the RPCs themselves enforce
 * `patient_id = auth.uid()` (or a real `manage` grant for a linked
 * dependent), so this route can only ever spend the caller's own balance
 * against a purchase the caller is authorised to make.
 *
 * patientId defaults to the caller's own id (self-funding) but may be a
 * linked dependent, same authority check record_service_purchase_intent
 * itself enforces — this route never re-derives or loosens that, it just
 * passes the caller's choice through (same pattern as topup-intent/route.ts).
 */
const bodySchema = z.object({
  patientId: z.string().uuid().optional(),
  serviceProductCode: z.string().min(1),
  scopedEntityType: z.string().optional(),
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

  const { data, error } = await supabase.rpc("pay_service_purchase_on_platform_credit", {
    p_service_purchase_id: purchaseId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, result: data });
}
