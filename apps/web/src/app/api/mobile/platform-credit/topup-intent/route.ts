import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { initiatePlatformCreditTopupCheckout } from "@/lib/billing/platform-credit-checkout";

/**
 * Mobile equivalent of apps/web/.../patient/platform-credit/actions.ts's
 * topUpPlatformCredit — same two-step shape (record_platform_credit_topup_intent,
 * then initiatePlatformCreditTopupCheckout), just returning the Paystack
 * checkout URL as JSON instead of issuing a server-side redirect, since the
 * mobile app hands that URL to WebBrowser.openBrowserAsync itself rather
 * than following a redirect. Crediting the balance still only ever happens
 * in private.apply_platform_credit_topup_payment once the webhook lands a
 * real payment_transactions row — never here.
 *
 * patientId defaults to the caller's own id (self-funding) but may be a
 * linked dependent, same authority check the RPC itself enforces
 * (private.can_purchase_voucher_for) — this route never re-derives or
 * loosens that, it just passes the caller's choice through.
 */
const bodySchema = z.object({
  patientId: z.string().uuid().optional(),
  amountKobo: z.number().int().positive(),
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
  if (!user.email) {
    return NextResponse.json(
      { error: "Your account needs an email on file to fund your balance." },
      { status: 400 }
    );
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

  const { data: intentId, error: intentError } = await supabase.rpc(
    "record_platform_credit_topup_intent",
    { p_patient_id: patientId, p_amount_kobo: parsed.data.amountKobo }
  );
  if (intentError || !intentId) {
    return NextResponse.json(
      { error: intentError?.message ?? "Could not start this top-up" },
      { status: 400 }
    );
  }

  const { data: intent, error: loadError } = await supabase
    .from("platform_credit_topup_intents")
    .select("id, organisation_id, patient_id, amount_kobo")
    .eq("id", intentId)
    .single();
  if (loadError || !intent) {
    return NextResponse.json(
      { error: loadError?.message ?? "Could not load the top-up you just started" },
      { status: 500 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiatePlatformCreditTopupCheckout({
    topupIntentId: intent.id,
    organisationId: intent.organisation_id,
    patientId: intent.patient_id,
    amountKobo: intent.amount_kobo,
    email: user.email,
    callbackUrl: `${siteUrl}/patient/care#platform-credit`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, checkoutUrl: result.checkoutUrl, intentId: intent.id });
}
