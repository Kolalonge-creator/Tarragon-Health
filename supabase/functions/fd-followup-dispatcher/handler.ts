// Front Desk dispatcher: POST /functions/v1/fd-followup-dispatcher. It delivers three things, each decided by the database:
//   1. follow-up emails (only while the master switch is on; every sending rule lives in service_fd_claim_runs),
//   2. handoff ALERTS to the founder (the time-critical one: an emergency wording alert),
//   3. the founder's REPLIES to visitors,
//   4. the WEEKLY REPORT to the founder (made by the database on Friday; this only sends it).
// pg_cron calls it every 5 minutes, and a new handoff calls it at once. Auth is the vault secret fd_followup_secret in x-fd-followup-secret.
// Fails closed without its secret. Alerts do NOT depend on the follow-up secrets: an emergency alert must go out even if the rest is unset.
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";
import type { EmailProvider } from "../_shared/integrations/email.ts";
import { deliverAlerts, deliverReplies, deliverReports, dispatchFollowups, type AlertDeps, type ClaimedRun, type DeliveryResult, type DispatchResult, type ReplyDeps, type ReportDeps } from "../_shared/frontdesk/index.ts";

export interface HandlerDeps {
  readonly secret: string | null;
  readonly unsubscribeSecret: string | null;
  readonly email: EmailProvider | null;
  readonly appBaseUrl: string;
  readonly siteUrl: string;
  readonly claim: (limit: number) => Promise<{ ok: true; runs: readonly ClaimedRun[] } | { ok: false; error: string }>;
  readonly finish: (runId: string, ok: boolean, messageId: string | null, error: string | null) => Promise<void>;
  /** Where handoff alerts go. Without it, alerts stay pending (and the response says so). */
  readonly founderEmail?: string | null;
  readonly alerts?: Pick<AlertDeps, "claim" | "finish">;
  readonly replies?: Pick<ReplyDeps, "claim" | "finish">;
  /** The weekly report goes to founderEmail too. Like alerts, it does not depend on the follow-up secrets. */
  readonly reports?: Pick<ReportDeps, "claim" | "finish">;
}

export async function handleDispatch(req: Request, deps: HandlerDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("x-fd-followup-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  // Without email nothing is claimed, so nothing is consumed: everything simply waits for the next tick.
  if (!deps.email) return Response.json({ error: "email_unavailable" }, { status: 503 });

  const out: {
    followups: DispatchResult | { skipped: string } | { error: string };
    alerts: DeliveryResult | { skipped: string } | { error: string };
    replies: DeliveryResult | { skipped: string } | { error: string };
    reports: DeliveryResult | { skipped: string } | { error: string };
  } = { followups: { skipped: "unsubscribe_secret_missing" }, alerts: { skipped: "not_configured" }, replies: { skipped: "not_configured" }, reports: { skipped: "not_configured" } };

  // 2 first: the alert is the most time-critical thing this function does.
  if (deps.alerts) {
    out.alerts = deps.founderEmail
      ? await deliverAlerts({ email: deps.email, to: deps.founderEmail, appBaseUrl: deps.appBaseUrl, claim: deps.alerts.claim, finish: deps.alerts.finish })
      : { skipped: "founder_alert_email_missing" };
  }
  if (deps.reports) {
    out.reports = deps.founderEmail
      ? await deliverReports({ email: deps.email, to: deps.founderEmail, appBaseUrl: deps.appBaseUrl, claim: deps.reports.claim, finish: deps.reports.finish })
      : { skipped: "founder_alert_email_missing" };
  }
  if (deps.unsubscribeSecret) {
    out.followups = await dispatchFollowups({ email: deps.email, claim: deps.claim, finish: deps.finish, unsubscribeSecret: deps.unsubscribeSecret, appBaseUrl: deps.appBaseUrl, siteUrl: deps.siteUrl });
    if (deps.replies) {
      out.replies = await deliverReplies({ email: deps.email, appBaseUrl: deps.appBaseUrl, unsubscribeSecret: deps.unsubscribeSecret, claim: deps.replies.claim, finish: deps.replies.finish });
    }
  }

  const parts = [out.followups, out.alerts, out.replies, out.reports];
  const broken = parts.some((p) => "error" in p || ("unrecorded" in p && p.unrecorded > 0));
  // A send that went out but could not be recorded, or an unreadable queue, is not a success: 500 makes the failed cron call visible.
  return Response.json(out, { status: broken ? 500 : 200 });
}
