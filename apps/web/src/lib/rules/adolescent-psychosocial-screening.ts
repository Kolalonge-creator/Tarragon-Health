/**
 * Adolescent psychosocial check-in scoring (spec §49.5/§49.6) — a HEEADSSS-
 * style structured interview (Home, Education, Eating/Activities, Drugs/
 * alcohol, Sexuality, Suicide/depression, Safety), adapted for self-
 * administration rather than a scored total like PHQ-9/GAD-7/AUDIT-C.
 *
 * Pure — no DB access — so it is unit-testable and re-runnable server-side as
 * the source of truth (mirrors apps/web/src/lib/rules/mental-health-
 * screening.ts). The five flags below are never a diagnosis; they route to
 * the emergency/safeguarding pathway (see
 * supabase/migrations/20260902210919_adolescent_health_module.sql) for a
 * clinician to review, never actioned by software alone.
 */

export type YesNo = "yes" | "no";

export interface AdolescentPsychosocialAnswers {
  homeFeelsSafe: YesNo;
  homeHurtOrThreatened: YesNo;
  educationNote: string;
  daysActivePerWeek: number;
  sleepHoursPerNight: number;
  substanceUseLastMonth: YesNo;
  sexualHealthSupportRequested: YesNo;
  selfHarmThoughts: YesNo;
  unsafeElsewhere: YesNo;
  immediateDanger: YesNo;
  notes: string;
}

export interface AdolescentPsychosocialResult {
  domainResponses: Record<string, unknown>;
  selfHarmFlagged: boolean;
  immediateDangerFlagged: boolean;
  /** Home/Safety domains suggesting possible abuse, neglect or exploitation — routed to safeguarding, not the emergency pathway (see the migration header for why). */
  abuseNeglectExploitationFlagged: boolean;
  substanceUseConcernFlagged: boolean;
  /** The patient asked for confidential sexual/reproductive-health follow-up — a support/education routing signal, not a safeguarding matter. */
  sexualHealthFollowUpRequested: boolean;
}

export function scoreAdolescentPsychosocialScreen(
  a: AdolescentPsychosocialAnswers
): AdolescentPsychosocialResult {
  return {
    domainResponses: {
      home: { feels_safe: a.homeFeelsSafe, hurt_or_threatened: a.homeHurtOrThreatened },
      education: { note: a.educationNote || null },
      eating_activity: {
        days_active_per_week: a.daysActivePerWeek,
        sleep_hours_per_night: a.sleepHoursPerNight,
      },
      drugs_alcohol: { used_last_month: a.substanceUseLastMonth },
      sexuality: { support_requested: a.sexualHealthSupportRequested },
      suicide_depression: { self_harm_thoughts: a.selfHarmThoughts },
      safety: {
        unsafe_elsewhere: a.unsafeElsewhere,
        immediate_danger: a.immediateDanger,
        notes: a.notes || null,
      },
    },
    selfHarmFlagged: a.selfHarmThoughts === "yes",
    immediateDangerFlagged: a.immediateDanger === "yes",
    abuseNeglectExploitationFlagged:
      a.homeFeelsSafe === "no" || a.homeHurtOrThreatened === "yes" || a.unsafeElsewhere === "yes",
    substanceUseConcernFlagged: a.substanceUseLastMonth === "yes",
    sexualHealthFollowUpRequested: a.sexualHealthSupportRequested === "yes",
  };
}
