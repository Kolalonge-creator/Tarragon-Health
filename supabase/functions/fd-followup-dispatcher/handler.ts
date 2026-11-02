// Front Desk follow-up dispatcher: POST /functions/v1/fd-followup-dispatcher. pg_cron calls this every 5 minutes (only while the master
// switch fd_app_config.followups_enabled is on) with the vault secret fd_followup_secret in x-fd-followup-secret. The database decides what
// may be sent (consent, suppression, quiet hours, caps, goal reached, dry-run); this renders and sends it. Fails closed without its secret.
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";
import type { EmailProvider } from "../_shared/integrations/email.ts";
import { dispatchFollowups, type ClaimedRun } from "../_shared/frontdesk/index.ts";

export interface HandlerDeps {
  readonly secret: string | null;
  readonly unsubscribeSecret: string | null;
  readonly email: EmailProvider | null;
  readonly appBaseUrl: string;
  readonly siteUrl: string;
  readonly claim: (limit: number) => Promise<{ ok: true; runs: readonly ClaimedRun[] } | { ok: false; error: string }>;
  readonly finish: (runId: string, ok: boolean, messageId: string | null, error: string | null) => Promise<void>;
}

export async function handleDispatch(req: Request, deps: HandlerDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("x-fd-followup-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  // Without these nothing is claimed, so nothing is consumed: the runs simply wait for the next tick.
  if (!deps.email) return Response.json({ error: "email_unavailable" }, { status: 503 });
  if (!deps.unsubscribeSecret) return Response.json({ error: "unsubscribe_secret_missing" }, { status: 503 });
  const result = await dispatchFollowups({
    email: deps.email,
    claim: deps.claim,
    finish: deps.finish,
    unsubscribeSecret: deps.unsubscribeSecret,
    appBaseUrl: deps.appBaseUrl,
    siteUrl: deps.siteUrl,
  });
  if ("error" in result) return Response.json({ error: "claim_failed" }, { status: 500 });
  // A send that went out but could not be recorded is not a success: 500 makes the failed cron call visible instead of silent.
  if (result.unrecorded > 0) return Response.json(result, { status: 500 });
  return Response.json(result);
}
