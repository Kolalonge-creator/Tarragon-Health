import "server-only";
import { createMlClientFromEnv } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

/** The ML service is optional (never load-bearing), so "not deployed" is a normal state, not an outage: nothing to reach is not the same as something that stopped answering. */
export interface MlCheck {
  status: "up" | "down" | "not_deployed";
  latency_ms: number;
}

export interface ConfiguredCheck {
  status: "configured" | "unconfigured";
  /** How we know: the env var is present in this process, or a message actually went out recently. Absent when unconfigured. */
  evidence?: "env" | "recent_send";
  /** ISO time of the newest successful send on that channel, when evidence is recent_send. */
  last_sent_at?: string;
}

/** How far back a successful send still counts as proof the channel works. Email goes out every day (test pages at 06:50 UTC); SMS is rare (phone codes only). */
const SEND_EVIDENCE_WINDOW_DAYS = 7;

export interface DependencyReport {
  checked_at: string;
  supabase: TimedCheck;
  ml_service: MlCheck;
  termii: ConfiguredCheck;
  paystack: ConfiguredCheck;
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
 * the server answers, not whether the caller is authorised. Empirically
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
export async function checkMlService(): Promise<MlCheck> {
  const client = createMlClientFromEnv();
  // No URL/key means no ML host exists (docs/ARCHITECTURE.md: not provisioned). That is "not deployed", not "down":
  // "down" is reserved for a service that IS configured but stopped answering, which is the signal worth acting on.
  if (!client) return { status: "not_deployed", latency_ms: 0 };

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

type SendsClient = {
  from(table: "notifications"): {
    select(cols: string): {
      eq(col: string, v: string): {
        eq(col: string, v: string): {
          gte(col: string, v: string): {
            order(col: string, o: { ascending: boolean }): {
              limit(n: number): { maybeSingle(): PromiseLike<{ data: { sent_at: string | null } | null; error: { message: string } | null }> };
            };
          };
        };
      };
    };
  };
};

/**
 * Email (Resend) and SMS (Termii) are sent by the Supabase edge sender with Supabase edge secrets, not by this Next.js process,
 * so the web env var is normally absent on purpose and presence-only reported "unconfigured" while mail was going out every day
 * (seen on the admin dashboard 2026-11-02). Evidence beats presence: a successful send on the channel inside the window means
 * the channel works end to end. The env var still counts when it is set. Never throws; a failed read is "unconfigured".
 */
export async function checkChannel(channel: "email" | "sms", envVar: string | undefined, client?: SendsClient): Promise<ConfiguredCheck> {
  if (envVar) return { status: "configured", evidence: "env" };
  try {
    const supabase = client ?? (createServiceRoleClient() as unknown as SendsClient);
    const since = new Date(Date.now() - SEND_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("notifications")
      .select("sent_at")
      .eq("channel", channel)
      .eq("status", "sent")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data?.sent_at) return { status: "configured", evidence: "recent_send", last_sent_at: data.sent_at };
  } catch {
    // fall through: no evidence is "unconfigured", never an exception on a status probe
  }
  return { status: "unconfigured" };
}

export async function checkDependencies(): Promise<DependencyReport> {
  const [supabase, ml_service, termii, resend] = await Promise.all([
    checkSupabase(),
    checkMlService(),
    checkChannel("sms", process.env.TERMII_API_KEY),
    checkChannel("email", process.env.RESEND_API_KEY),
  ]);
  return {
    checked_at: new Date().toISOString(),
    supabase,
    ml_service,
    termii,
    paystack: checkConfigured(process.env.PAYSTACK_SECRET_KEY),
    resend,
  };
}

/** The providers the integrations centre lists (lib/integrations-centre/model.ts). */
export type ProviderKeyName = "paystack" | "email" | "push" | "sms" | "zoom" | "ai" | "clamav" | "maps";

/**
 * Whether each provider's key is present in this process, for the integrations centre. Presence only: a value never
 * leaves this function, and nothing is sent. It lives here, beside the other status checks, because this module is the
 * one place allowed to look at provider keys without using them (the Part C scan exempts it, packages/shared). A key
 * being present is never on its own taken as proof a provider works; the page judges that from recorded activity.
 * Push's signing key is held by the sending edge function, so only the public key can be seen from here.
 */
export function providerKeysPresent(): Record<ProviderKeyName, boolean> {
  return {
    paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
    email: Boolean(process.env.RESEND_API_KEY),
    push: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    sms: Boolean(process.env.TERMII_API_KEY),
    zoom: Boolean(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    clamav: Boolean(process.env.SCANNER_SERVICE_URL),
    maps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
  };
}

