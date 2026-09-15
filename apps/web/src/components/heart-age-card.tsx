"use client";

import Link from "next/link";
import { useLatestHeartAge, useHeartAgeHistory } from "@/lib/queries/heart-age";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import { useIsFeatureEnabled } from "@/lib/queries/feature-flags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { computeHeartAgeTrend, describeHeartAgeTrend } from "@/lib/rules/heart-age";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";
import type { HealthScoreRiskLevel } from "@/lib/rules/health-score";

/**
 * Replaces the retired BiologicalAgeCard (see the archived `biological_age_card`
 * feature flag, migration 20260914213944) with a real, published
 * risk-communication technique: converting the patient's already-computed
 * SCORE2 10-year cardiovascular risk into an age, the same "risk age" method
 * the SCORE working group's own charts and the Framingham/JBS3/NHS
 * "heart age" tools use (see services/ml/app/scoring/heart_age.py for the
 * full clinical/methodology notes and citations).
 *
 * Unlike the old card, this one never re-derives anything at read time — the
 * age shown is a real, stored SCORE2 output (patient_risk_scores,
 * score_type='heart_age'), written only when a genuine SCORE2 result exists
 * for the patient (age 40-89, real lipid panel + BP + smoking status on
 * file). No row existing is therefore itself the honest "not enough data
 * yet" signal — there is no separate eligibility check to duplicate here.
 *
 * Gated behind the `heart_age_card` feature flag (default `status = 'off'`,
 * migration 20260914213943) for the same reason its predecessor was: no
 * Clinical Director sign-off exists yet, and this card's reference
 * risk-factor profile (heart_age.py's PROVISIONAL_REFERENCE_PROFILE) is
 * explicitly provisional pending that review. Do not flip the live-DB flag
 * to 'on'/'rollout' without that sign-off actually happening first.
 */
const RISK_LEVEL_STYLE: Record<
  HealthScoreRiskLevel,
  { badgeVariant: "green" | "amber" | "red"; label: string }
> = {
  low: { badgeVariant: "green", label: "On track" },
  moderate: { badgeVariant: "amber", label: "Room to improve" },
  high: { badgeVariant: "red", label: "Needs attention" },
  very_high: { badgeVariant: "red", label: "Needs urgent attention" },
};

export function HeartAgeCard({ patientId }: { patientId: string }) {
  const isEnabled = useIsFeatureEnabled("heart_age_card");
  const { data: latest, isLoading: isLatestLoading, isError } = useLatestHeartAge(patientId);
  const { data: history } = useHeartAgeHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isLatestLoading || isAgeLoading;

  // Flag off: nothing to show, self-hides rather than a broken/placeholder
  // state, same convention as every other conditional dashboard card.
  if (!isEnabled) return null;

  const trend = history ? computeHeartAgeTrend(history) : null;
  const trendLine = trend ? describeHeartAgeTrend(trend) : null;

  const heartAgeYears = latest?.score ?? null;
  const riskLevel = latest?.risk_level as HealthScoreRiskLevel | null;
  const badgeStyle = riskLevel ? RISK_LEVEL_STYLE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;
  const cvdRiskPct = latest?.inputs?.cvd_risk_10yr_percent ?? null;
  const referenceRiskPct = latest?.inputs?.reference_risk_10yr_percent ?? null;
  // ScoreRing's fill convention (established by HealthScoreCard) is "more
  // fill = better" — a raw heart-age-in-years value would invert that (an
  // older, worse heart age would fill MORE of the ring), so the ring is
  // driven by the inverse of the risk percentage instead, exactly like the
  // old BiologicalAgeCard fed it the Health Score rather than the estimated
  // age itself. The age stays the prominent number as the ring's center text.
  const ringFillValue = cvdRiskPct != null ? Math.max(0, Math.min(100, 100 - cvdRiskPct)) : null;

  const ageGapYears =
    heartAgeYears != null && chronologicalAge != null ? chronologicalAge - heartAgeYears : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive
            className="h-5 w-5 text-deep-forest dark:text-brand-green-bright"
            strokeWidth={2}
          />
          Your Heart Age
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load your Heart Age.</p>
        )}
        {!isLoading && !isError && heartAgeYears == null && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            We&apos;ll show a Heart Age once you have a cholesterol panel and blood pressure/smoking
            status on file — ask your care team about a lipid panel at your next visit.
          </p>
        )}
        {!isLoading && !isError && heartAgeYears != null && badgeStyle && (
          <>
            <div className="flex flex-col items-center gap-3.5">
              <ScoreRing value={ringFillValue ?? 0} colorVar={ringColorVar}>
                <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {heartAgeYears}
                </span>
                <span className="mt-0.5 text-[13px] font-medium text-charcoal-ink/55 dark:text-night-ink/55">
                  yrs, estimated
                </span>
              </ScoreRing>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge variant={badgeStyle.badgeVariant}>{badgeStyle.label}</Badge>
                {ageGapYears !== null && ageGapYears !== 0 && (
                  <span
                    className={
                      ageGapYears > 0
                        ? "inline-flex items-center rounded-full border border-brand-green/30 px-2.5 py-0.5 text-xs font-medium text-brand-green dark:border-brand-green-bright/30 dark:text-brand-green-bright"
                        : "inline-flex items-center rounded-full border border-charcoal-ink/15 px-2.5 py-0.5 text-xs font-medium text-charcoal-ink/60 dark:border-night-ink/20 dark:text-night-ink/60"
                    }
                  >
                    {Math.abs(ageGapYears)} {Math.abs(ageGapYears) === 1 ? "yr" : "yrs"}{" "}
                    {ageGapYears > 0 ? "younger" : "older"} than your actual age ({chronologicalAge})
                  </span>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              The age at which someone with ideal blood pressure and cholesterol would carry the same
              10-year cardiovascular risk your own results show — not a lab-based or genetic
              biological-age test, and not a medical diagnosis. 10-year CVD risk is estimated with
              SCORE2 (European-derived) and is not validated for Sub-Saharan African populations;
              treat it as a guide and confirm clinically.
              {latest?.computed_at && ` Updated ${new Date(latest.computed_at).toLocaleDateString()}.`}
            </p>

            {trendLine && (
              <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                {trendLine}
              </p>
            )}

            <Link
              href="/patient/heart-age"
              className="flex items-center justify-between text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              See your trend over time
              <NAV_ICON.chevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>

            {cvdRiskPct != null && referenceRiskPct != null && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="flex flex-col gap-0.5 rounded-lg bg-warm-ivory dark:bg-night-ink/10 px-3 py-2.5">
                  <span className="text-[11px] text-charcoal-ink/55 dark:text-night-ink/55">
                    Your 10-year CVD risk
                  </span>
                  <span className="text-[17px] font-semibold text-charcoal-ink dark:text-night-ink">
                    {cvdRiskPct}%
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-lg bg-warm-ivory dark:bg-night-ink/10 px-3 py-2.5">
                  <span className="text-[11px] text-charcoal-ink/55 dark:text-night-ink/55">
                    Ideal-profile risk at this age
                  </span>
                  <span className="text-[17px] font-semibold text-charcoal-ink dark:text-night-ink">
                    {referenceRiskPct}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
