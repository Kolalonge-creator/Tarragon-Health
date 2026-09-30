// Deployed entrypoint for the auth Send SMS hook. All logic is in handler.ts (see its header) so it can be
// tested without Deno.serve. Enable in the Supabase dashboard: Authentication > Hooks > Send SMS > HTTPS, then set
// SEND_SMS_HOOK_SECRET (the secret the dashboard issues), SMS_LOG_PEPPER (any long random string), and leave
// SMS_PROVIDER unset (mock) until the Termii sender ID is approved (OQ-21, D-05).
// verify_jwt is off: Auth authenticates with the Standard Webhooks signature, not a JWT (supabase/config.toml).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleHookRequest, type SmsLogStore } from "./handler.ts";
import { providerFromEnv } from "./provider.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const store: SmsLogStore = {
  async countLastHour(phoneHash) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("sms_delivery_log")
      .select("id", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", since);
    if (error) throw new Error("log_unreadable");
    return count ?? 0;
  },
  async insert(row) {
    const { error } = await supabase.from("sms_delivery_log").insert({
      phone_hash: row.phoneHash,
      user_id: row.userId,
      provider: row.provider,
      status: row.status,
      attempts: row.attempts,
      provider_message_id: row.providerMessageId ?? null,
      error_code: row.errorCode ?? null,
    });
    if (error) throw new Error("log_write_failed");
  },
};

Deno.serve((req) =>
  handleHookRequest(req, {
    secret: Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "",
    pepper: Deno.env.get("SMS_LOG_PEPPER") ?? "",
    provider: providerFromEnv((k) => Deno.env.get(k)),
    store,
  }),
);
