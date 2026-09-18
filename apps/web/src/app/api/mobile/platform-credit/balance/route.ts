import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import type { Tables } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/src/lib/queries/platform-credit.ts's
 * useMyPlatformCreditBalance / usePlatformCreditConfig / useMyPlatformCreditLedger
 * — same pattern as the AI Coach mobile passthrough
 * (apps/web/src/app/api/mobile/ai-coach/message/route.ts): a bearer-authenticated
 * route that runs the exact same RLS-scoped reads the web hooks run, just
 * reached over HTTPS from the Expo app instead of through Supabase's JS
 * client directly. No service-role client anywhere here — RLS enforces
 * `patient_id = auth.uid()` (or org-staff) on every one of these tables, so
 * this route can only ever read the caller's own balance/ledger.
 *
 * Balance-viewing only: this does not spend credit against anything, and
 * there is no mobile "spend" route yet (deliberately — see the task this
 * shipped under). It just gives the native balance card something to show.
 */
export async function GET(request: Request): Promise<NextResponse> {
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

  const [balanceResult, configResult, ledgerResult] = await Promise.all([
    supabase
      .from("platform_credit_balances")
      .select("*")
      .eq("patient_id", user.id)
      .maybeSingle(),
    supabase.from("platform_credit_config").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("platform_credit_ledger_entries")
      .select("*")
      .eq("patient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (balanceResult.error) {
    return NextResponse.json({ error: balanceResult.error.message }, { status: 500 });
  }
  if (ledgerResult.error) {
    return NextResponse.json({ error: ledgerResult.error.message }, { status: 500 });
  }

  const balance = balanceResult.data as Tables<"platform_credit_balances"> | null;
  const config = configResult.data as Tables<"platform_credit_config"> | null;
  const ledger = (ledgerResult.data ?? []) as Tables<"platform_credit_ledger_entries">[];

  return NextResponse.json({
    success: true,
    balance_kobo: balance?.balance_kobo ?? 0,
    paid_balance_kobo: balance?.paid_balance_kobo ?? 0,
    promo_balance_kobo: balance?.promo_balance_kobo ?? 0,
    config: config
      ? {
          min_topup_kobo: config.min_topup_kobo,
          max_topup_kobo: config.max_topup_kobo,
          suggested_amounts_kobo: config.suggested_amounts_kobo,
        }
      : null,
    ledger: ledger.map((entry) => ({
      id: entry.id,
      entry_type: entry.entry_type,
      amount_kobo: entry.amount_kobo,
      description: entry.description,
      created_at: entry.created_at,
    })),
  });
}
