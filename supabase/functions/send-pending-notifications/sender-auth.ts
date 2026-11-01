// Who may drive the notification sender. pg_cron and the database triggers (private.kick_notification_sender, nudge_send_pending,
// enqueue_critical_notification, escalate_unconfirmed_critical_notifications) all call it with the vault secret
// notification_sender_secret in the x-sender-secret header. The secret is checked inside the database
// (public.verify_notification_sender_secret, service role only), so it has one home and nothing has to be copied into the function's
// environment. Fails closed: an unreachable database is a refusal, never a pass.

export type VerifySenderSecret = (secret: string) => Promise<{ ok: boolean; failed: boolean }>;

export const SENDER_SECRET_HEADER = "x-sender-secret";

/** Null when the caller may proceed, otherwise the response to return. */
export async function refuseUnlessSender(req: Request, verify: VerifySenderSecret): Promise<Response | null> {
  const refuse = (status: 401 | 503, error: string, why: string) => {
    // A 401 is not sent to Sentry (only 5xx are), so a refused cron call after a rotation mismatch would otherwise be silent in the
    // function logs. private.sweep_paging_health is the alarm that pages a human if critical rows then sit unsent.
    console.warn(`send-pending-notifications refused a caller: ${why}`);
    return Response.json({ error }, { status });
  };
  const given = req.headers.get(SENDER_SECRET_HEADER) ?? "";
  if (given === "") return refuse(401, "unauthorised", "no secret header");
  const result = await verify(given);
  if (result.failed) return refuse(503, "unable to verify caller", "database could not verify");
  return result.ok ? null : refuse(401, "unauthorised", "secret did not match");
}
