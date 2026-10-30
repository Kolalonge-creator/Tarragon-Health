// OQ-267: the per-user limit for edge functions that bypass the web proxy. The count and the limits live in the database
// (public.edge_rate_limit_hit, run with the caller's own JWT); this only asks and turns a refusal into a 429.
// Fails open: if the limiter call itself errors or returns something unexpected, the request goes ahead, so a limiter outage
// can never block a payment or a clinician.

export type EdgeBucket = "order-checkout" | "order-verify" | "queue-next" | "queue-handback";

export type EdgeRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export async function edgeRateLimited(rpc: EdgeRpc, bucket: EdgeBucket, timeoutMs = 1500): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // a hung limiter must not hold up a payment: past the timeout the request goes ahead
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const answer = await Promise.race([Promise.resolve(rpc("edge_rate_limit_hit", { p_bucket: bucket })), timeout]);
    if (answer === null) return null;
    const { data, error } = answer;
    if (error) return null;
    const d = data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
    if (!d || d.allowed !== false) return null;
    // an unauthorised or unknown-bucket answer is not a rate limit: leave the function's own checks to decide
    if (typeof d.retry_after_seconds !== "number") return null;
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(d.retry_after_seconds) } });
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
