import "server-only";
import { createMlClientFromEnv } from "@tarragon/shared";

/**
 * Live, introspective dependency checks for `/api/status` (§90.17/§90.18 —
 * see docs/BUSINESS_CONTINUITY_DR_SPEC.md). Distinct from the Sentry uptime
 * monitors, which ping individual URLs from outside: this asks "can this
 * running instance reach its own dependencies right now," which can catch a
 * degraded-but-still-200 instance an external ping would miss.
 *
 * Same never-throw discipline as packages/shared/src/ml-client.ts — every
 * check resolves, none reject, so a caller never needs its own try/catch.
 */

const CHECK_TIMEOUT_MS = 3_000;

export interface TimedCheck {
  status: "up" | "down";
  latency_ms: number;
}

export interface ConfiguredCheck {
  status: "configured" | "unconfigured";
}

export interface DependencyReport {
  checked_at: string;
  supabase: TimedCheck;
  ml_service: TimedCheck;
  whatsapp: ConfiguredCheck;
  termii: ConfiguredCheck;
  paystack: ConfiguredCheck;
  stripe: ConfiguredCheck;
  resend: ConfiguredCheck;
}

/** Any HTTP response (any status) proves the server is reachable — only a
 * timeout or network-level failure (no response at all) resolves false. */
async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    await fetch(url, { signal: controller.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liveness only — never touches a patient table, needs no API key. Hits
 * GoTrue's own `/auth/v1/health` and treats *any* HTTP response as proof the
 * project is reachable, including a 401/403/404 — this is checking whether
 * the server answers, not whether the caller is authorized. Empirically
 * confirmed against the live project (2026-08-30): this endpoint actually
 * returns 401 without an apikey header, not the 200 a "health endpoint"
 * name suggests, so treating only a 2xx as "up" would misreport a perfectly
 * healthy project as down. Only a timeout or network-level failure (no
 * response at all) counts as down.
 */
export async function checkSupabase(): Promise<TimedCheck> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { status: "down", latency_ms: 0 };

  const start = Date.now();
  const reachable = await isReachable(`${base}/auth/v1/health`);
  return { status: reachable ? "up" : "down", latency_ms: Date.now() - start };
}

/** Thin wrapper around the existing never-throw ML client — zero new fallback logic. */
export async function checkMlService(): Promise<TimedCheck> {
  const client = createMlClientFromEnv();
  if (!client) return { status: "down", latency_ms: 0 };

  const start = Date.now();
  const result = await client.health();
  return { status: result ? "up" : "down", latency_ms: Date.now() - start };
}

/**
 * Presence-only — never live-pings a payment/messaging provider from an
 * unauthenticated route, matching the existing isZoomConfigured()/
 * isTwilioProxyConfigured() pattern (lib/zoom/client.ts, lib/twilio/proxy-client.ts).
 */
export function checkConfigured(envVar: string | undefined): ConfiguredCheck {
  return { status: envVar ? "configured" : "unconfigured" };
}

export async function checkDependencies(): Promise<DependencyReport> {
  const [supabase, ml_service] = await Promise.all([checkSupabase(), checkMlService()]);
  return {
    checked_at: new Date().toISOString(),
    supabase,
    ml_service,
    whatsapp: checkConfigured(process.env.WHATSAPP_TOKEN),
    termii: checkConfigured(process.env.TERMII_API_KEY),
    paystack: checkConfigured(process.env.PAYSTACK_SECRET_KEY),
    stripe: checkConfigured(process.env.STRIPE_SECRET_KEY),
    resend: checkConfigured(process.env.RESEND_API_KEY),
  };
}
