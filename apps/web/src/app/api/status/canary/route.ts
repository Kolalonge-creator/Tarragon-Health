import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Public-safe heartbeat for the clinical chain canary (OQ-316). A free outside uptime monitor polls this and alerts on any non-200
 * (or on `"ok":false` with a keyword check). It returns ONLY `{ ok, age_bucket }`: no timestamp, no id, no pass or fail detail, no
 * configuration, nothing about a patient, and no secret. 200 when a canary run finished recently, 503 when the canary has gone quiet or
 * the database could not be read (a monitor must treat "cannot tell" as down). While the canary is gated off (no real patient exists yet, the same condition its cron job uses) it answers 200 with `"gated"` so a monitor does not report a healthy quiet system as down. Excluded from proxy.ts's matcher with the rest of
 * /api/status so a degraded Supabase Auth cannot hang it. Runbook: docs/runbooks/canary-external-heartbeat.md.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const BUCKETS = new Set(["gated", "never", "under_1h", "1h_to_3h", "3h_to_24h", "over_24h"]);

export async function GET(): Promise<NextResponse> {
  const ip = await getClientIp();
  const { success } = await rateLimit(`status-canary:ip:${ip}`, { limit: 30, windowSeconds: 60 });
  if (!success) return NextResponse.json({ ok: false, age_bucket: "unknown" }, { status: 429, headers: NO_STORE });

  try {
    const { data, error } = await createServiceRoleClient().rpc("canary_heartbeat");
    const row = data as { ok?: unknown; age_bucket?: unknown } | null;
    if (error || !row || typeof row.ok !== "boolean" || typeof row.age_bucket !== "string" || !BUCKETS.has(row.age_bucket)) {
      return NextResponse.json({ ok: false, age_bucket: "unknown" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ ok: row.ok, age_bucket: row.age_bucket }, { status: row.ok ? 200 : 503, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, age_bucket: "unknown" }, { status: 503, headers: NO_STORE });
  }
}
