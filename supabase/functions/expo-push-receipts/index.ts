// S13: Expo push receipts. An Expo ticket only says Expo accepted a message. About 15 minutes later the receipt says
// whether APNs or FCM did, and reports a token that is no longer valid (DeviceNotRegistered). pg_cron calls this every
// 10 minutes with the shared secret header x-notification-jobs-secret (Vault notification_jobs_secret, edge secret
// NOTIFICATION_JOBS_SECRET). A receipt is a platform fact, not proof the person saw the message. Never throws past its boundary.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { classifyExpoReceipt, type ExpoReceipt } from "../_shared/notifications/delivery.ts";

interface Due { event_id: string; notification_id: string; provider_ref: string; subscription_id: string | null }

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("NOTIFICATION_JOBS_SECRET");
  if (!expected) return Response.json({ error: "not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-notification-jobs-secret") ?? "", expected)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: rules } = await supabase
    .from("notification_rules_config").select("config").eq("is_active", true)
    .maybeSingle<{ config: { receiptCheckMinutes?: number; receiptGiveUpHours?: number } }>();
  const { data, error } = await supabase.rpc("claim_expo_receipt_checks", {
    p_limit: 300,
    p_min_age_minutes: rules?.config.receiptCheckMinutes ?? 15,
    p_max_age_hours: rules?.config.receiptGiveUpHours ?? 24,
  });
  if (error) return Response.json({ checked: 0, error: error.message });
  const due = (data ?? []) as Due[];
  if (due.length === 0) return Response.json({ checked: 0, delivered: 0, tokenDead: 0, failed: 0, waiting: 0 });

  let receipts: Record<string, ExpoReceipt> = {};
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: due.map((d) => d.provider_ref) }),
    });
    clearTimeout(timer);
    if (!res.ok) return Response.json({ checked: 0, error: `expo ${res.status}` });
    receipts = ((await res.json()) as { data?: Record<string, ExpoReceipt> }).data ?? {};
  } catch (e) {
    return Response.json({ checked: 0, error: e instanceof Error ? e.message : "expo unreachable" });
  }

  let delivered = 0, tokenDead = 0, failed = 0, waiting = 0;
  for (const d of due) {
    const outcome = classifyExpoReceipt(receipts[d.provider_ref]);
    if (!outcome) { waiting++; continue; } // not ready yet: it stays claimable
    const detail: Record<string, unknown> = d.subscription_id ? { subscription_id: d.subscription_id } : {};
    if (outcome.event === "failed") detail.reason = outcome.reason;
    await supabase.rpc("record_notification_delivery_event", {
      p_notification_id: d.notification_id,
      p_event: outcome.event,
      p_provider: "expo",
      p_provider_ref: d.provider_ref,
      p_detail: detail,
    });
    if (outcome.event === "delivered") delivered++;
    else if (outcome.event === "token_dead") tokenDead++;
    else failed++;
  }
  return Response.json({ checked: due.length, delivered, tokenDead, failed, waiting });
});
