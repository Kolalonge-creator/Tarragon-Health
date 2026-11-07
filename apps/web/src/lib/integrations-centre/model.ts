import { z } from "zod";
import type { HealthState } from "@/lib/admin-overview/model";

/**
 * The integrations centre (docs/design/SUPERADMIN-CONSOLE.md, phase 2d): each platform provider, what it has actually
 * done in the last 7 days (public.admin_integration_status), and whether its key is set. No server-only imports, so
 * the page and its tests share one definition. A key being set is never, on its own, evidence a provider works.
 */

const count = z.number().int().nonnegative();
const when = z.string().nullable();

const activitySchema = z.object({
  ok_7d: count,
  failed_7d: count.nullable(),
  last_ok_at: when,
  last_failed_at: when,
  webhooks_ok_7d: count.optional(),
  webhooks_bad_7d: count.optional(),
  last_webhook_at: when.optional(),
});
export type Activity = z.infer<typeof activitySchema>;

export const statusSchema = z.object({
  computed_at: z.string(),
  since: z.string(),
  paystack: activitySchema,
  email: activitySchema,
  push: activitySchema,
  sms: activitySchema,
  zoom: activitySchema,
  ai: activitySchema,
  clamav: activitySchema,
});
export type IntegrationStatus = z.infer<typeof statusSchema>;

export type ActivityKey = Exclude<keyof IntegrationStatus, "computed_at" | "since">;

export interface ProviderDef {
  /** Also the key in providerKeysPresent() (lib/status/check-dependencies.ts), which says whether its key is set. */
  key: ActivityKey | "maps";
  name: string;
  category: "Payments" | "Communication" | "Appointments and video" | "AI" | "Location" | "Infrastructure";
  /** What the provider does for Tarragon, in a line. */
  role: string;
  /** Where to look deeper. */
  detailHref: string;
  /** What "ok" and "failed" count for this provider, shown under its figures. */
  measures: string;
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    key: "paystack",
    name: "Paystack",
    category: "Payments",
    role: "Card and bank payments in naira, refunds and payouts.",
    detailHref: "/admin/ops/providers",
    measures: "Confirmed payments and payment events; failed means an event we could not process. A declined card is the customer's bank, not a Paystack failure.",
  },
  {
    key: "email",
    name: "Resend (email)",
    category: "Communication",
    role: "Email notifications and delivery reports.",
    detailHref: "/admin/ops/automation-health",
    measures: "Emails sent and emails that failed; webhooks are Resend's delivery reports.",
  },
  {
    key: "push",
    name: "Push notifications",
    category: "Communication",
    role: "Phone and browser push (Expo and web push).",
    detailHref: "/admin/ops/automation-health",
    // The private signing key lives in the edge function's environment, which the web app cannot see; only the public
    // key is checked here, so the 7-day evidence, not "Key set", is what says whether push works.
    measures: "Push messages sent and push messages that failed. \"Key set\" checks the public key only; the signing key is held by the sending service.",
  },
  {
    key: "sms",
    name: "Termii (SMS)",
    category: "Communication",
    role: "Phone verification codes only. No clinical message is ever sent by SMS.",
    detailHref: "/admin/security",
    measures: "Codes Termii sent and codes it failed to send. Our own rate limiting is not a failure.",
  },
  {
    key: "zoom",
    name: "Zoom",
    category: "Appointments and video",
    role: "Video consultations.",
    detailHref: "/admin/consultations",
    measures: "Consultations given a Zoom meeting. A failed meeting set-up is not recorded per meeting; Zoom's webhooks show the other side.",
  },
  {
    key: "ai",
    name: "Anthropic (AI)",
    category: "AI",
    role: "The AI features registered in AI governance.",
    detailHref: "/admin/ops/ai-monitoring",
    measures: "AI calls that completed, and calls that failed or fell back because the model did not answer. A guardrail block is neither.",
  },
  {
    key: "clamav",
    name: "ClamAV (virus scanning)",
    category: "Infrastructure",
    role: "Scans every uploaded file before anyone can open it.",
    detailHref: "/admin/security",
    measures: "Files the scanner answered for (clean or infected), and scans it could not do.",
  },
  {
    key: "maps",
    name: "Google Maps",
    category: "Location",
    role: "Maps and places for testing-day and lab locations.",
    detailHref: "/admin/ops/diagnostic-directory",
    measures: "Maps load in the person's browser, so the platform keeps no record of calls.",
  },
];

export interface ProviderLine {
  state: HealthState;
  /** One sentence on what the state rests on. */
  evidence: string;
}

/** Below this share of failures a provider is "Degraded"; at or above "all failing", "Failed". */
export const DEGRADED_FAILURE_SHARE = 0.2;

/**
 * Turns 7 days of evidence into a state. Order matters: nothing happening with no key is "Not configured"; nothing
 * happening with a key is "Unknown" (a key proves nothing); only real successes make "Operational"; failures with no
 * success are "Failed"; a failure share at or above 20% is "Degraded". Rejected webhooks degrade a provider only when
 * they outnumber good ones, because a stray unsigned probe is not an outage.
 */
export function providerLine(activity: Activity | null, keySet: boolean, formatTime: (iso: string) => string): ProviderLine {
  if (!activity) {
    return keySet
      ? { state: "unknown", evidence: "A key is set, but the platform keeps no record of calls to check it against." }
      : { state: "not_configured", evidence: "No key is set." };
  }
  const ok = activity.ok_7d;
  const failed = activity.failed_7d ?? 0;
  const whOk = activity.webhooks_ok_7d ?? 0;
  const whBad = activity.webhooks_bad_7d ?? 0;
  const lastOk = activity.last_ok_at ? `last success ${formatTime(activity.last_ok_at)}` : "no success ever recorded";

  if (ok === 0 && failed === 0 && whOk === 0 && whBad === 0) {
    if (!keySet && !activity.last_ok_at) return { state: "not_configured", evidence: "No key is set and nothing has been recorded." };
    return { state: "unknown", evidence: `Nothing in the last 7 days; ${lastOk}.` };
  }
  if (ok === 0 && failed > 0) return { state: "failed", evidence: `${failed} failed and none succeeded in the last 7 days; ${lastOk}.` };
  const share = ok + failed === 0 ? 0 : failed / (ok + failed);
  if (share >= DEGRADED_FAILURE_SHARE) {
    return { state: "degraded", evidence: `${failed} of ${ok + failed} failed in the last 7 days (${Math.round(share * 100)}%).` };
  }
  if (whBad > whOk && whBad >= 3) {
    return { state: "degraded", evidence: `${whBad} webhooks rejected or failed against ${whOk} processed in the last 7 days.` };
  }
  if (ok === 0) return { state: "unknown", evidence: `Only webhooks in the last 7 days (${whOk} processed); ${lastOk}.` };
  return { state: "operational", evidence: `${ok} succeeded${failed ? `, ${failed} failed` : ""} in the last 7 days; ${lastOk}.` };
}
