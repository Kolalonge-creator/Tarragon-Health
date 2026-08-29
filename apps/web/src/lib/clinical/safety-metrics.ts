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
 * §31.17 names six standing signals to monitor continuously: (a) unresolved
 * critical alerts, (b) overdue clinical actions, (c) abnormal results without
 * review, (d) referrals without follow-up, (e) medications without required
 * monitoring, (f) patients disappearing from high-risk programmes. All but
 * (f) are covered below — (f) needs a product definition of what counts as
 * programme disengagement, which is a judgement call rather than a gap this
 * module can close on its own.
 */

export interface SafetyMetrics {
  /** §31.12 "Open incidents" — filed and not yet closed, any severity. */
  openIncidents: number;
  /** §31.12 "Serious incidents" — high/critical and still open (§31.9's trigger for senior review). */
  seriousIncidents: number;
  /** §31.12 "Near misses" — a volume signal, so windowed to the last 90 days rather than all time. */
  nearMisses90d: number;
  /**
   * §31.12 / §31.17b "Overdue clinical reviews" — every review type with a
   * due_date that has gone past it while still pending: medication reviews,
   * preventive reviews, lifestyle-programme (LPE) reviews, and annual health
   * reviews. Not just medication_reviews, which was this tile's original,
   * narrower scope.
   */
  overdueClinicalReviews: number;
  /** §31.12 "Unacknowledged critical" — urgent/emergency alerts nobody has picked up. */
  unacknowledgedCritical: number;
  /** §31.12 "Referral failures" — specialist referrals that ended declined. */
  referralFailures: number;
  /**
   * §31.17c "Abnormal results without review" — abnormal_result-type alerts
   * still sitting in the open (pre-acknowledgement) state, any severity —
   * broader than unacknowledgedCritical, which only counts urgent/emergency.
   */
  abnormalResultsUnreviewed: number;
  /**
   * §31.17d "Referrals without follow-up" — a specialist visit was booked or
   * confirmed, its appointment date has passed, and nothing came back: no
   * treatment plan note, no shared-care handback. The referral was not
   * declined (referralFailures already covers that) — it was simply never
   * followed up on.
   */
  referralsWithoutFollowUp: number;
  /**
   * §31.17e "Medications without required monitoring" — a patient on a
   * monitored drug class (statins, etc.) whose required lab check is past
   * its due date and still pending.
   */
  medicationsOverdueMonitoring: number;
}

/** Alert levels that count as "critical" for the unacknowledged tile. */
const CRITICAL_ALERT_LEVELS: Database["public"]["Enums"]["alert_level"][] = [
  "urgent_escalation",
  "emergency",
];

/** Referral states a booked visit can still be sitting in when its date passes with no follow-up. */
const FOLLOWED_UP_PENDING_STATUSES: Database["public"]["Enums"]["referral_status"][] = [
  "booked",
  "confirmed",
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
  const nowIso = now.toISOString();

  const head = { count: "exact" as const, head: true };

  const [
    open,
    serious,
    nearMisses,
    overdueMedicationReviews,
    overduePreventiveReviews,
    overdueLifestyleReviews,
    overdueAnnualReviews,
    unacked,
    referralFailures,
    abnormalResultsUnreviewed,
    referralsWithoutFollowUp,
    medicationsOverdueMonitoring,
  ] = await Promise.all([
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
    supabase.from("medication_reviews").select("id", head).eq("status", "pending").lt("due_date", today),
    supabase.from("preventive_reviews").select("id", head).eq("status", "pending").lt("due_date", today),
    supabase.from("lpe_reviews").select("id", head).eq("status", "pending").lt("due_date", today),
    supabase
      .from("annual_reviews")
      .select("id", head)
      .in("status", ["pending", "in_progress"])
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
    supabase
      .from("clinician_alerts")
      .select("id", head)
      .eq("status", "open")
      .eq("suppressed", false)
      .eq("type_code", "abnormal_result"),
    supabase
      .from("specialist_referrals")
      .select("id", head)
      .in("status", FOLLOWED_UP_PENDING_STATUSES)
      .lt("appointment_date", nowIso)
      .is("treatment_plan_note", null)
      .is("shared_care_handback_at", null),
    supabase
      .from("medication_lab_monitoring")
      .select("id", head)
      .eq("status", "pending")
      .lt("due_date", today),
  ]);

  return {
    openIncidents: open.count ?? 0,
    seriousIncidents: serious.count ?? 0,
    nearMisses90d: nearMisses.count ?? 0,
    overdueClinicalReviews:
      (overdueMedicationReviews.count ?? 0) +
      (overduePreventiveReviews.count ?? 0) +
      (overdueLifestyleReviews.count ?? 0) +
      (overdueAnnualReviews.count ?? 0),
    unacknowledgedCritical: unacked.count ?? 0,
    referralFailures: referralFailures.count ?? 0,
    abnormalResultsUnreviewed: abnormalResultsUnreviewed.count ?? 0,
    referralsWithoutFollowUp: referralsWithoutFollowUp.count ?? 0,
    medicationsOverdueMonitoring: medicationsOverdueMonitoring.count ?? 0,
  };
}

export const NEAR_MISS_WINDOW_LABEL = `last ${NEAR_MISS_WINDOW_DAYS} days`;

/**
 * Which tiles are demanding action right now, so the dashboard can lead with
 * a plain sentence instead of making a reader compare numbers against
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
  if (metrics.abnormalResultsUnreviewed > 0) {
    concerns.push(
      `${metrics.abnormalResultsUnreviewed} abnormal result${metrics.abnormalResultsUnreviewed === 1 ? "" : "s"} still unreviewed`,
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
  if (metrics.referralsWithoutFollowUp > 0) {
    concerns.push(
      `${metrics.referralsWithoutFollowUp} referral${metrics.referralsWithoutFollowUp === 1 ? "" : "s"} with a past appointment and no follow-up on file`,
    );
  }
  if (metrics.medicationsOverdueMonitoring > 0) {
    concerns.push(
      `${metrics.medicationsOverdueMonitoring} medication${metrics.medicationsOverdueMonitoring === 1 ? "" : "s"} overdue for required monitoring`,
    );
  }
  return concerns;
}
