// Deployed entrypoint for the auth Send SMS hook. All logic is in handler.ts (see its header) so it can be tested
// without Deno.serve. Enable in the Supabase dashboard: Authentication > Hooks > Send SMS > HTTPS, then set
// SEND_SMS_HOOK_SECRET (the secret the dashboard issues) and SMS_LOG_PEPPER (any long random string).
// Leave SMS_PROVIDER unset until the Termii sender ID is approved (OQ-21, D-05): unset REFUSES every send, so phone
// sign-up fails loudly instead of pretending a code was sent. SMS_PROVIDER=mock (sends nothing, reports success) is for
// local stacks only.
// verify_jwt is off: Auth authenticates with the Standard Webhooks signature, not a JWT (supabase/config.toml).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleHookRequest, MAX_SENDS_PER_HOUR, type SmsLogStore } from "./handler.ts";
import { providerFromEnv } from "./provider.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const store: SmsLogStore = {
  async reserve(phoneHash, userId, provider) {
    const { data, error } = await supabase.rpc("reserve_auth_sms_slot", {
      p_phone_hash: phoneHash,
      p_user_id: userId,
      p_provider: provider,
      p_max: MAX_SENDS_PER_HOUR,
    });
    if (error) throw new Error("reserve_failed");
    return (data as string | null) ?? null;
  },
  async finish(reservationId, outcome) {
    const { error } = await supabase
      .from("sms_delivery_log")
      .update({
        status: outcome.status,
        attempts: outcome.attempts,
        provider_message_id: outcome.providerMessageId ?? null,
        error_code: outcome.errorCode ?? null,
      })
      .eq("id", reservationId);
    if (error) throw new Error("finish_failed");
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
