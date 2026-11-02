import type { EmailProvider } from "../integrations/email.ts";
import { renderFollowup } from "./followup-render.ts";
import { unsubscribeToken } from "./unsubscribe-token.ts";

/** One run the database says may be sent now (service_fd_claim_runs). */
export interface ClaimedRun {
  readonly run_id: string;
  readonly contact_id: string;
  readonly email: string;
  readonly first_name: string | null;
  readonly sequence_key: string;
  readonly step_key: string;
  readonly subject: string;
  readonly body_text: string;
  readonly attempt: number;
}

export interface DispatchDeps {
  readonly email: EmailProvider;
  readonly claim: (limit: number) => Promise<{ ok: true; runs: readonly ClaimedRun[] } | { ok: false; error: string }>;
  readonly finish: (runId: string, ok: boolean, messageId: string | null, error: string | null) => Promise<void>;
  readonly unsubscribeSecret: string;
  readonly appBaseUrl: string;
  readonly siteUrl: string;
  readonly batch?: number;
}

export interface DispatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
}

/**
 * Sends what the database claimed, one at a time (Resend is rate limited and this runs every 5 minutes; a batch is small). Never throws:
 * a send that fails is recorded as failed and retried by the database after an hour, at most three times. The idempotency key is the run id,
 * so a retry after a send that actually succeeded but was not recorded cannot deliver twice (the provider dedupes the key).
 */
export async function dispatchFollowups(deps: DispatchDeps): Promise<DispatchResult | { error: string }> {
  const claimed = await deps.claim(deps.batch ?? 25);
  if (!claimed.ok) return { error: claimed.error };
  let sent = 0;
  let failed = 0;
  for (const run of claimed.runs) {
    try {
      const token = await unsubscribeToken(deps.unsubscribeSecret, run.contact_id);
      const unsubscribeUrl = `${deps.appBaseUrl}/api/frontdesk/unsubscribe?c=${run.contact_id}&t=${token}`;
      const mail = renderFollowup({
        subject: run.subject,
        bodyText: run.body_text,
        firstName: run.first_name,
        stepKey: run.step_key,
        sequenceKey: run.sequence_key,
        appBaseUrl: deps.appBaseUrl,
        siteUrl: deps.siteUrl,
        unsubscribeUrl,
      });
      const res = await deps.email.send({
        to: run.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        audience: "patient",
        idempotencyKey: `fd-run-${run.run_id}`,
        tags: { source: "front_desk", sequence: run.sequence_key },
        headers: mail.headers,
      });
      if (res.ok) {
        await deps.finish(run.run_id, true, res.data.providerMessageId, null);
        sent += 1;
      } else {
        await deps.finish(run.run_id, false, null, `${res.error.code}: ${res.error.message}`);
        failed += 1;
      }
    } catch (e) {
      await deps.finish(run.run_id, false, null, e instanceof Error ? e.message : "unknown").catch(() => undefined);
      failed += 1;
    }
  }
  return { claimed: claimed.runs.length, sent, failed };
}
