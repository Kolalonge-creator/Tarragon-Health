import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";

/**
 * Mobile equivalent of apps/web/.../patient/video-visit-actions.ts's
 * requestVideoVisitWithPlatformCredit — same two-step shape (insert the
 * video_visit_requests row under RLS, then call
 * confirm_video_visit_request_on_platform_credit), just reached over HTTPS
 * from the Expo app instead of a Next.js server action running against the
 * cookie session. Both run under the CALLER'S OWN RLS via createBearerClient
 * (never service role) — this route has no more authority over
 * video_visit_requests than the mobile client itself would.
 *
 * confirm_video_visit_request_on_platform_credit only ever CHECKS the
 * caller's platform credit balance and flips status to 'payment_confirmed'
 * if it covers the pinned price — nothing is actually spent here. The real
 * spend is deferred to the moment a doctor accepts
 * (private.pay_video_visit_request_on_platform_credit, called from
 * accept_video_visit_request / select_video_visit_alternate_slot), so a
 * request that's later declined or expires needs no refund on this path.
 * See 20260917230244_video_visit_platform_credit_covers_check.sql's header
 * for the full design reasoning — not to be relitigated here.
 *
 * The RPC's own "insufficient balance" / "not payable" / "unsupported
 * currency" outcomes are business results, not HTTP errors — this route
 * returns them as a 200 with `ok: false` so the client can show a specific
 * message (e.g. how much more credit is needed), exactly like the RPC's own
 * jsonb shape. Only genuine request failures (bad auth, bad input, an
 * unexpected DB error) return a non-2xx status.
 */
const bodySchema = z.object({
  slotId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

type ConfirmResult =
  | { ok: true; request_id: string; amount_kobo: number }
  | { ok: false; reason: "not_payable"; status: string }
  | { ok: false; reason: "unsupported_currency"; currency: string }
  | {
      ok: false;
      reason: "insufficient_balance";
      balance_kobo: number;
      required_kobo: number;
      shortfall_kobo: number;
    };

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
    return NextResponse.json({ error: "Pick a time first" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "Your account has no organisation on file." }, { status: 400 });
  }

  // RLS-visible check that the slot is still open before creating a request
  // for it — mirrors insertVideoVisitRequestRow's own preamble.
  const { data: slot } = await supabase
    .from("consult_availability_slots")
    .select("id")
    .eq("id", parsed.data.slotId)
    .maybeSingle();
  if (!slot) {
    return NextResponse.json(
      { error: "That time is no longer available, pick another slot." },
      { status: 400 }
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("video_visit_requests")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      slot_id: parsed.data.slotId,
      note: parsed.data.note ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "Could not create the request." },
      { status: 400 }
    );
  }
  // Captured as its own const (not `inserted.id` inline below): TS can't
  // carry the `inserted !== null` narrowing above into a closure that
  // might run later, since the closure captures the variable itself, not
  // its narrowed type at this point.
  const requestId = inserted.id;

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "confirm_video_visit_request_on_platform_credit",
    { p_request_id: requestId }
  );
  const result = rpcData as ConfirmResult | null;

  // Never leave a half-created, unpaid request lingering on any failure
  // path below — the patient can simply try again (with platform credit
  // after topping up, or by card via the web checkout hand-off).
  async function deleteUnpaidRequest(): Promise<void> {
    await supabase
      .from("video_visit_requests")
      .delete()
      .eq("id", requestId)
      .in("status", ["requested", "pending_payment"]);
  }

  if (rpcError || !result) {
    await deleteUnpaidRequest();
    return NextResponse.json(
      { error: rpcError?.message ?? "Could not reserve this visit with platform credit." },
      { status: 400 }
    );
  }

  if (!result.ok) {
    await deleteUnpaidRequest();
    // A real business outcome from the RPC (not an HTTP-level error) —
    // return it in the RPC's own shape at 200, plus a human-readable
    // `error` so the mobile client always has something to show without
    // needing to special-case every `reason` itself.
    const message =
      result.reason === "insufficient_balance"
        ? `You need ₦${Math.ceil(result.shortfall_kobo / 100).toLocaleString()} more in platform credit to reserve this visit.`
        : result.reason === "unsupported_currency"
          ? "This visit can't be paid with platform credit."
          : "This request can no longer be paid this way.";
    return NextResponse.json({ ...result, error: message });
  }

  return NextResponse.json({
    ok: true,
    request_id: result.request_id,
    amount_kobo: result.amount_kobo,
  });
}
