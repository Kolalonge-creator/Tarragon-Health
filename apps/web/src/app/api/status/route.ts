import { NextResponse } from "next/server";
import { checkDependencies } from "@/lib/status/check-dependencies";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Unauthenticated dependency-health probe (§90.17/§90.18, see
 * docs/BUSINESS_CONTINUITY_DR_SPEC.md) — deliberately reachable without a
 * session (checkable from a terminal or a phone during an outage, when
 * logging in may itself be part of the problem), so it's rate-limited by IP
 * instead. Excluded from proxy.ts's matcher (see the comment there) so a
 * degraded Supabase Auth can't hang this check before it ever reports the
 * degradation.
 *
 * Only the Supabase check can flip the HTTP status to 503 — every other
 * dependency already has a documented non-fatal fallback (ML: never throws,
 * see ml-client.ts; WhatsApp/Termii: additive by design, see CLAUDE.md), so
 * this mirrors the platform's own "must keep working if a dependency is
 * down" doctrine rather than treating every dependency as equally critical.
 */
export async function GET(): Promise<NextResponse> {
  const ip = await getClientIp();
  const { success } = await rateLimit(`status:ip:${ip}`, { limit: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json(
      { ok: false, error: "Too many requests" },
      { status: 429 }
    );
  }

  const { checked_at, ...checks } = await checkDependencies();
  const ok = checks.supabase.status === "up";

  return NextResponse.json(
    { ok, checked_at, checks },
    { status: ok ? 200 : 503 }
  );
}
