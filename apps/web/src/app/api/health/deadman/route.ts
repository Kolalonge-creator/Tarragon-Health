import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { evaluateDeadman, loadDeadmanThresholds, parseDeadmanStatus } from "@/lib/status/deadman-evaluation";
import { isHealthRequestAuthorised } from "@/lib/status/health-auth";

/**
 * OQ-436: the endpoint an EXTERNAL dead-man's switch polls. Every watcher inside Supabase (pg_cron, pg_net, the paging health
 * sweep) dies together with pg_cron, so this is read from outside: .github/workflows/deadman-switch.yml every 5 minutes, and
 * optionally a free third-party HTTP monitor (docs/PLATFORM_OUTAGE_RUNBOOK.md).
 *
 *   curl -H "x-health-secret: $HEALTH_CHECK_SECRET" https://app.tarragonhealth.ng/api/health/deadman
 *
 * Same shared secret and fail-closed behaviour as /api/health/deep: no secret configured => 503 and nothing is read; wrong or
 * missing secret => 401. Read-only; the body carries counts and ages only (public.deadman_status(), service_role only), never a
 * patient or staff identifier. 200 for ok or degraded, 503 for down or when the database cannot be read. Excluded from the proxy
 * matcher (`api/health/`) so a degraded Supabase Auth cannot hang it.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = isHealthRequestAuthorised(request.headers, process.env.HEALTH_CHECK_SECRET);
  if (auth === "not_configured") return NextResponse.json({ ok: false, error: "not configured" }, { status: 503, headers: NO_STORE });
  if (auth === "denied") return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401, headers: NO_STORE });

  const thresholds = loadDeadmanThresholds();
  const started = Date.now();
  try {
    // database.types.ts is not regenerated here (production types would import other branches), so the RPC is called untyped.
    const supabase = createServiceRoleClient() as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      supabase.rpc("deadman_status", { p_due_older_than_seconds: thresholds.dueOlderThanSeconds }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), thresholds.dbQueryTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const status = result.error ? null : parseDeadmanStatus(result.data);
    if (!status) {
      return NextResponse.json({ ok: false, verdict: "down", error: "status_failed", latency_ms: Date.now() - started }, { status: 503, headers: NO_STORE });
    }
    const evaluated = evaluateDeadman(status, thresholds);
    return NextResponse.json(
      { ok: evaluated.verdict !== "down", verdict: evaluated.verdict, latency_ms: Date.now() - started, status, checks: evaluated.checks },
      { status: evaluated.verdict === "down" ? 503 : 200, headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ ok: false, verdict: "down", error: "database_unreachable", latency_ms: Date.now() - started }, { status: 503, headers: NO_STORE });
  }
}
