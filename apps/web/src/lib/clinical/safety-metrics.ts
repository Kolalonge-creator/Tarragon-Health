import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { UNRESOLVED_INCIDENT_STATUSES } from "@/lib/clinical/incident-governance";

/**
 * The clinical safety dashboard's counts (spec §31.12) and the standing
 * safety-monitoring signals behind them (§31.17).
 *
 * Every count runs through the CALLER's RLS-scoped client, never the service
 * role: `private.is_org_staff` already scopes each of these tables to the
 * viewer's organisation, so there is no organisation filter here to get wrong
 * and no reason to reach past RLS to produce a management number. They are
 * `head: true` count queries — no rows cross the wire, only totals.
 *
 * The six tiles are the spec's own list. Where the spec names a metric the
 * platform measures under a different name, the mapping is recorded on the
 * field itself rather than left for a reader to guess.
 */

export interface SafetyMetrics {
  /** §31.12 "Open incidents" — filed and not yet closed, any severity. */
  openIncidents: number;
  /** §31.12 "Serious incidents" — high/critical and still open (§31.9's trigger for senior review). */
  seriousIncidents: number;
  /** §31.12 "Near misses" — a volume signal, so windowed to the last 90 days rather than all time. */
  nearMisses90d: number;
  /** §31.12 "Overdue clinical reviews" — medication reviews past their due date and still pending. */
  overdueClinicalReviews: number;
  /** §31.12 "Unacknowledged critical" — urgent/emergency alerts nobody has picked up. */
  unacknowledgedCritical: number;
  /** §31.12 "Referral failures" — specialist referrals that ended declined. */
  referralFailures: number;
}

/** Alert levels that count as "critical" for the unacknowledged tile. */
const CRITICAL_ALERT_LEVELS: Database["public"]["Enums"]["alert_level"][] = [
  "urgent_escalation",
  "emergency",
];

const NEAR_MISS_WINDOW_DAYS = 90;

/** Africa/Lagos is the platform timezone; "overdue" is judged against today there. */
function todayInLagos(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

function windowStart(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchSafetyMetrics(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<SafetyMetrics> {
  const today = todayInLagos(now);
  const nearMissSince = windowStart(now, NEAR_MISS_WINDOW_DAYS);

  const head = { count: "exact" as const, head: true };

  const [open, serious, nearMisses, overdueReviews, unacked, referralFailures] = await Promise.all([
    supabase
      .from("clinical_incident_reports")
      .select("id", head)
      .in("status", UNRESOLVED_INCIDENT_STATUSES),
    supabase
      .from("clinical_incident_reports")
      .select("id", head)
      .in("status", UNRESOLVED_INCIDENT_STATUSES)
      .in("severity", ["high", "critical"]),
    supabase
      .from("clinical_incident_reports")
      .select("id", head)
      .eq("severity", "near_miss")
      .gte("reported_at", nearMissSince),
    supabase
      .from("medication_reviews")
      .select("id", head)
      .eq("status", "pending")
      .lt("due_date", today),
    // 'open' is the pre-acknowledgement state in the alert lifecycle
    // (open → acknowledged → resolved/closed), so an alert still sitting in
    // it is by definition unacknowledged. Suppressed alerts are excluded:
    // they are deliberate duplicates, not unattended work.
    supabase
      .from("clinician_alerts")
      .select("id", head)
      .eq("status", "open")
      .eq("suppressed", false)
      .in("level", CRITICAL_ALERT_LEVELS),
    supabase.from("specialist_referrals").select("id", head).eq("status", "declined"),
  ]);

  return {
    openIncidents: open.count ?? 0,
    seriousIncidents: serious.count ?? 0,
    nearMisses90d: nearMisses.count ?? 0,
    overdueClinicalReviews: overdueReviews.count ?? 0,
    unacknowledgedCritical: unacked.count ?? 0,
    referralFailures: referralFailures.count ?? 0,
  };
}

export const NEAR_MISS_WINDOW_LABEL = `last ${NEAR_MISS_WINDOW_DAYS} days`;

/**
 * Which tiles are demanding action right now, so the dashboard can lead with
 * a plain sentence instead of making a reader compare six numbers against
 * remembered thresholds.
 *
 * Deliberately conservative: only counts that represent unattended clinical
 * risk raise an alarm. Near misses never do — a rising near-miss count is a
 * reporting culture working, and colouring it as a problem is how a safety
 * log gets quietly abandoned (§31.10).
 */
export function safetyConcerns(metrics: SafetyMetrics): string[] {
  const concerns: string[] = [];
  if (metrics.unacknowledgedCritical > 0) {
    concerns.push(
      `${metrics.unacknowledgedCritical} critical alert${metrics.unacknowledgedCritical === 1 ? "" : "s"} nobody has picked up`,
    );
  }
  if (metrics.seriousIncidents > 0) {
    concerns.push(
      `${metrics.seriousIncidents} serious incident${metrics.seriousIncidents === 1 ? "" : "s"} still open`,
    );
  }
  if (metrics.overdueClinicalReviews > 0) {
    concerns.push(`${metrics.overdueClinicalReviews} clinical reviews past their due date`);
  }
  return concerns;
}
