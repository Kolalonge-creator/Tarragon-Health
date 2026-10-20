import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { evaluateSnapshot, loadHealthThresholds, worst, type HealthCheck, type HealthSnapshot, type Verdict } from "@/lib/status/health-evaluation";
import { canarySchema, deepHealthFactsSchema, evaluateDeepHealth, failingNames, publicChecks } from "@/lib/status/deep-health";
import { isHealthRequestAuthorised } from "@/lib/status/health-auth";

/**
 * SR1 / OQ-436 / OQ-452: the deep health check for an external dead-man monitor (UptimeRobot, Better Stack, Cronitor and the like).
 * Runbook: docs/runbooks/external-dead-man-monitor.md.
 *
 *   curl -H "x-health-secret: $HEALTH_CHECK_SECRET" https://app.tarragonhealth.ng/api/health/deep
 *
 * What it checks, all read with the service role and decided here:
 *   - the database answers (public.platform_health_snapshot() within the time limit),
 *   - the snapshot measures: connections, overdue clinical tasks, unacknowledged red pages, notification and event backlogs, webhook
 *     backlogs, pg_cron freshness (ops.health_thresholds, PROPOSED configuration),
 *   - the heartbeats of the queue jobs (queue_job_heartbeats: sweep-clinical-tasks, expire-task-claims, queue-watchdog) and of the paging
 *     engine (paging_heartbeats: sweep_pages, process_events, reconciler) via public.platform_deep_health(),
 *   - the number of open sev1 incidents (any open sev1 fails the check until it is resolved),
 *   - the chain canary heartbeat (public.canary_heartbeat()), which only runs through the process-events edge function.
 *
 * Status codes: 200 ONLY when every check is ok. 503 when any check is degraded or down, when the database cannot be read, or when the
 * secret is not configured on the server (fails closed, reads nothing). 401 when the secret is missing or wrong.
 *
 * The body carries check NAMES and verdicts only: `failing` lists the names of non-ok checks. It never carries an age, a count, a job
 * result, an error message, an id or any patient data. Detail for diagnosis is in /admin/ops, not here.
 *
 * Excluded from the proxy matcher (apps/web/src/proxy.ts) so a degraded Supabase Auth cannot hang it.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([Promise.resolve(p), timeout]).finally(() => clearTimeout(timer));
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = isHealthRequestAuthorised(request.headers, process.env.HEALTH_CHECK_SECRET);
  if (auth === "not_configured") return NextResponse.json({ ok: false, error: "not configured" }, { status: 503, headers: NO_STORE });
  if (auth === "denied") return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401, headers: NO_STORE });

  const thresholds = loadHealthThresholds();
  const started = Date.now();
  const down = (name: string) =>
    NextResponse.json({ ok: false, verdict: "down", failing: [name], latency_ms: Date.now() - started }, { status: 503, headers: NO_STORE });

  try {
    const supabase = createServiceRoleClient();
    const [snapshot, deep, canary] = await Promise.allSettled([
      withTimeout(supabase.rpc("platform_health_snapshot"), thresholds.dbQueryTimeoutMs),
      // platform_deep_health is newer than the generated types, so it is called through the loose signature.
      withTimeout((supabase as unknown as { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> }).rpc("platform_deep_health"), thresholds.dbQueryTimeoutMs),
      withTimeout(supabase.rpc("canary_heartbeat"), thresholds.dbQueryTimeoutMs),
    ]);

    // The snapshot is the "database reachable" check: without it nothing else can be trusted.
    if (snapshot.status !== "fulfilled" || snapshot.value.error || !snapshot.value.data) return down("database_unreachable");

    const checks: HealthCheck[] = [...evaluateSnapshot(snapshot.value.data as unknown as HealthSnapshot, thresholds).checks];
    const factsParsed = deep.status === "fulfilled" && !deep.value.error ? deepHealthFactsSchema.safeParse(deep.value.data) : null;
    const canaryParsed = canary.status === "fulfilled" && !canary.value.error ? canarySchema.safeParse(canary.value.data) : null;
    checks.push(...evaluateDeepHealth(factsParsed?.success ? factsParsed.data : null, canaryParsed?.success ? canaryParsed.data : null).checks);

    const verdict: Verdict = worst(checks.map((c) => c.verdict));
    const healthy = verdict === "ok";
    return NextResponse.json(
      { ok: healthy, verdict, failing: failingNames(checks), latency_ms: Date.now() - started, checks: publicChecks(checks) },
      { status: healthy ? 200 : 503, headers: NO_STORE },
    );
  } catch {
    return down("database_unreachable");
  }
}
