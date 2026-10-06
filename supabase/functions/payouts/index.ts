// S31: POST /functions/v1/payouts  { action: "send" | "verify_bank" | "banks", ... }. The caller's JWT decides who they are; the
// database decides what they may do. `send` is for an admin approving money to move (payout_prepare_send checks the go-live guard,
// the state and that no test account is paid); `verify_bank` is for a contracted clinician adding where they are paid. The Paystack
// secret never leaves this function. Webhook results arrive at paystack-webhook, not here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { selectPayment, type FetchLike } from "../_shared/integrations/index.ts";
import { listBanks, sendPayout, verifyBank, type PayoutDeps } from "../_shared/payouts/handler.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const who = await userClient.auth.getUser();
  if (who.error || !who.data.user) return Response.json({ error: "unauthorised" }, { status: 401 });
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const picked = selectPayment(Deno.env.toObject(), fetch as FetchLike);
  if (!picked.ok) return Response.json({ error: "not_configured" }, { status: 503 });
  const deps: PayoutDeps = {
    payment: picked.data,
    userId: who.data.user.id,
    asUser: async (fn, args) => {
      const r = await userClient.rpc(fn, args);
      return { data: r.data, error: r.error ? { message: r.error.message } : null };
    },
    asService: async (fn, args) => {
      const r = await service.rpc(fn, args);
      return { data: r.data, error: r.error ? { message: r.error.message } : null };
    },
  };
  let body: { action?: unknown; payout_id?: unknown; bank_code?: unknown; account_number?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const out =
    body.action === "send" ? await sendPayout(deps, body.payout_id)
    : body.action === "verify_bank" ? await verifyBank(deps, { bankCode: body.bank_code, accountNumber: body.account_number })
    : body.action === "banks" ? await listBanks(deps)
    : { status: 400, body: { error: "invalid_input" } };
  return Response.json(out.body, { status: out.status });
});
