import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createAndPayForLabOrder } from "@/lib/billing/create-and-pay-lab-order";

/**
 * Thin mobile wrapper around createAndPayForLabOrder — the native "book &
 * pay" button for any self-bookable panel bundle (the Sexual Health
 * testing tab today; deliberately not sexual-health-specific, so a future
 * native Labs screen can reuse this same route rather than growing a
 * second, parallel payment path). Cannot be a direct client call: initiating
 * the Paystack checkout needs the secret key inside initiateBookingCheckout,
 * never shipped to a client. Calls the *exact same* function the web "Book & pay"
 * button uses (createAndPayForPartnerLabOrder) via
 * createAndPayForLabOrder's client/caller/callbackUrl mobile seam.
 */
const checkoutSchema = z.object({
  panelBundleId: z.string().min(1),
  providerId: z.string().min(1).optional(),
  // Restricted to the app's own deep-link scheme (defense-in-depth): a
  // bearer token alone shouldn't be enough to redirect Paystack's
  // post-payment callback to an arbitrary URL.
  callbackUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("tarragonhealth://"), {
      message: "callbackUrl must use the tarragonhealth:// scheme",
    }),
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

  const result = await createAndPayForLabOrder({
    panelBundleId: parsed.data.panelBundleId,
    providerId: parsed.data.providerId,
    client: supabase,
    caller: { id: user.id, email: user.email },
    callbackUrl: parsed.data.callbackUrl,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ checkoutUrl: result.checkoutUrl });
}
