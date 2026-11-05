import "server-only";
import { getProposedConfig } from "@tarragon/shared";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Per-subject limits on actions that cost money or create records and were unlimited (security audit 2026-11-05, M-8):
 * anonymous page-view beacons, patient uploads, meal-photo AI estimates and adding a child to the family. The numbers live in
 * the registry key security.abuse_rate_limits. Each kind has one or more windows; all must allow the request.
 *
 * The subject is always something the server verified (a session user id, or the source IP for anonymous beacons), never a
 * value the client sent. Like every app-layer limit here this cannot stop a caller that goes straight to Supabase with its
 * own token; it bounds what this app will do on someone's behalf.
 */
export type AbuseLimitKind = "page_view" | "upload" | "meal_photo_ai" | "add_dependant";

type Rule = { limit: number; window_seconds: number };

export const ABUSE_LIMIT_MESSAGE = "You've done this a lot in a short time. Please wait a little, then try again.";

export function abuseLimitRules(kind: AbuseLimitKind): Rule[] {
  const all = getProposedConfig("security.abuse_rate_limits").value as unknown as Record<AbuseLimitKind, Rule[]>;
  return all[kind];
}

export async function checkAbuseLimit(
  kind: AbuseLimitKind,
  subject: string
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  // Shortest window first, stopping at the first refusal, so attempts the burst window already refused do not also use up
  // the daily allowance.
  const rules = [...abuseLimitRules(kind)].sort((a, b) => a.window_seconds - b.window_seconds);
  for (const r of rules) {
    const result = await rateLimit(`abuse:${kind}:${r.window_seconds}:${subject}`, { limit: r.limit, windowSeconds: r.window_seconds });
    if (!result.success) return { ok: false, retryAfterSeconds: Math.max(1, result.retryAfterSeconds) };
  }
  return { ok: true };
}
