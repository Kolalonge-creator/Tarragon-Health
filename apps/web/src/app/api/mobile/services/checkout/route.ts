import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

/**
 * Thin mobile wrapper around purchaseServiceProduct — the "My services"
 * native screen's Buy button. Cannot be a direct client call: initiating a
 * paid checkout needs the Paystack secret key (never shipped to a client)
 * inside initiateServicePurchaseCheckout, so this is the same
 * "needs an API route because it's service-role/secret-touching" class as
 * apps/web/src/app/api/mobile/vitals/route.ts, just for a secret key rather
 * than auth.admin.*. Calls the *exact same* server action function
 * purchaseServiceProduct — see its header comment for the `client`/
 * `caller`/`callbackUrl` seam this route exercises so the Expo app's bearer
 * session and `tarragonhealth://` deep-link scheme stand in for web's
 * cookie session and same-origin callback path.
 */
const checkoutSchema = z.object({
  serviceProductCode: z.string().min(1),
  promoCode: z.string().trim().optional(),
  callbackUrl: z.string().url(),
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
  if (authError || !user || !user.email) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const result = await purchaseServiceProduct({
    serviceProductCode: parsed.data.serviceProductCode,
    promoCode: parsed.data.promoCode,
    callbackPath: "",
    callbackUrl: parsed.data.callbackUrl,
    client: supabase,
    caller: { id: user.id, email: user.email },
  });

  if (result?.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ activated: result?.activated ?? false, checkoutUrl: result?.checkoutUrl ?? null });
}
