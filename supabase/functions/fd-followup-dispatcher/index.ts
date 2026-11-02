// Deployed entrypoint for fd-followup-dispatcher. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailFromEnv } from "../_shared/integrations/index.ts";
import type { ClaimedAlert, ClaimedReply, ClaimedReport, ClaimedRun } from "../_shared/frontdesk/index.ts";
import { handleDispatch } from "./handler.ts";

Deno.serve(async (req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // The reply-to lives in fd_app_config so it is brand data, not a deploy: it overrides RESEND_REPLY_TO for this sender only.
  const { data: reply } = await service.from("fd_app_config").select("value").eq("key", "reply_to").maybeSingle();
  const replyTo = typeof reply?.value === "string" && reply.value.length > 0 ? reply.value : Deno.env.get("RESEND_REPLY_TO");
  const email = emailFromEnv(
    { RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"), RESEND_FROM: Deno.env.get("RESEND_FROM"), RESEND_REPLY_TO: replyTo, RESEND_WEBHOOK_SECRET: Deno.env.get("RESEND_WEBHOOK_SECRET") },
    (input, init) => fetch(input, init),
  );
  return handleDispatch(req, {
    secret: Deno.env.get("FD_FOLLOWUP_SECRET") ?? null,
    unsubscribeSecret: Deno.env.get("FD_UNSUBSCRIBE_SECRET") ?? null,
    email,
    appBaseUrl: (Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng").replace(/\/$/, ""),
    siteUrl: (Deno.env.get("SITE_URL") ?? "https://tarragonhealth.ng").replace(/\/$/, ""),
    founderEmail: Deno.env.get("FOUNDER_ALERT_EMAIL") ?? null,
    alerts: {
      claim: async (limit) => {
        const { data, error } = await service.rpc("service_fd_claim_alerts", { p_limit: limit });
        return error ? { ok: false, error: error.message } : { ok: true, alerts: (data ?? []) as ClaimedAlert[] };
      },
      finish: async (handoffId, ok, err) => {
        const { error } = await service.rpc("service_fd_finish_alert", { p_handoff: handoffId, p_ok: ok, p_error: err });
        if (error) throw new Error(`could not record the outcome of alert ${handoffId}: ${error.message}`);
      },
    },
    replies: {
      claim: async (limit) => {
        const { data, error } = await service.rpc("service_fd_claim_replies", { p_limit: limit });
        return error ? { ok: false, error: error.message } : { ok: true, replies: (data ?? []) as ClaimedReply[] };
      },
      finish: async (handoffId, ok, messageId, err) => {
        const { error } = await service.rpc("service_fd_finish_reply", { p_handoff: handoffId, p_ok: ok, p_message_id: messageId, p_error: err });
        if (error) throw new Error(`could not record the outcome of reply ${handoffId}: ${error.message}`);
      },
    },
    reports: {
      claim: async (limit) => {
        const { data, error } = await service.rpc("service_fd_claim_reports", { p_limit: limit });
        return error ? { ok: false, error: error.message } : { ok: true, reports: (data ?? []) as ClaimedReport[] };
      },
      finish: async (reportId, ok, narrative, recipient, err) => {
        const { error } = await service.rpc("service_fd_finish_report", { p_report: reportId, p_ok: ok, p_narrative: narrative, p_recipient: recipient, p_error: err });
        if (error) throw new Error(`could not record the outcome of report ${reportId}: ${error.message}`);
      },
    },
    claim: async (limit) => {
      const { data, error } = await service.rpc("service_fd_claim_runs", { p_limit: limit });
      return error ? { ok: false, error: error.message } : { ok: true, runs: (data ?? []) as ClaimedRun[] };
    },
    finish: async (runId, ok, messageId, err) => {
      const { error } = await service.rpc("service_fd_finish_run", { p_run: runId, p_ok: ok, p_message_id: messageId, p_error: err });
      // supabase-js returns the error instead of throwing; surface it so a lost outcome is never silent.
      if (error) throw new Error(`could not record the outcome of run ${runId}: ${error.message}`);
    },
  });
});
