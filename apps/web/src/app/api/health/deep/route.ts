import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { evaluateSnapshot, loadHealthThresholds, type HealthSnapshot } from "@/lib/status/health-evaluation";
import { isHealthRequestAuthorised } from "@/lib/status/health-auth";

/**
 * SR1: deep health check for an external uptime monitor (Better Stack, UptimeRobot, Checkly and the like).
 *
 * Unlike /api/status (unauthenticated, Supabase reachability only) this one reads operational state: database
 * connections, queue and page age, notification backlog, event-bus backlog, webhook backlogs and cron freshness, all from
 * public.platform_health_snapshot() (service_role only). Because it reveals operating state it requires a shared secret:
 *
 *   curl -H "x-health-secret: $HEALTH_CHECK_SECRET" https://app.tarragonhealth.ng/api/health/deep
 *
 * Without HEALTH_CHECK_SECRET configured the route answers 503 "not configured" and reads nothing (fails closed). The
 * body carries counts, ages and job names only, never a patient identifier.
 *
 * Status codes: 200 ok or degraded, 503 down or when the database cannot be reached at all, 401 wrong secret.
 * Configure the monitor to alert on non-200 (page) and, if it can read the body, to warn when `verdict` is "degraded".
 * Excluded from the proxy matcher (apps/web/src/proxy.ts) so a degraded Supabase Auth cannot hang it.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = isHealthRequestAuthorised(request.headers, process.env.HEALTH_CHECK_SECRET);
  if (auth === "not_configured") return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  if (auth === "denied") return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });

  const thresholds = loadHealthThresholds();
  const started = Date.now();
  try {
    const supabase = createServiceRoleClient();
    const result = await Promise.race([
      supabase.rpc("platform_health_snapshot"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), thresholds.dbQueryTimeoutMs)),
    ]);
    if (result.error || !result.data) {
      return NextResponse.json({ ok: false, verdict: "down", error: "snapshot_failed", latency_ms: Date.now() - started }, { status: 503 });
    }
    const evaluated = evaluateSnapshot(result.data as unknown as HealthSnapshot, thresholds);
    return NextResponse.json(
      { ok: evaluated.verdict !== "down", verdict: evaluated.verdict, latency_ms: Date.now() - started, checks: evaluated.checks },
      { status: evaluated.verdict === "down" ? 503 : 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, verdict: "down", error: "database_unreachable", latency_ms: Date.now() - started }, { status: 503 });
  }
}
