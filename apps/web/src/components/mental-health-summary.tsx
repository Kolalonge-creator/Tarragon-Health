"use client";

import { useLatestMentalHealthScreens } from "@/lib/queries/mental-health";
import {
  PHQ9_BAND_LABEL,
  GAD7_BAND_LABEL,
  AUDITC_BAND_LABEL,
  type Phq9Band,
  type Gad7Band,
  type AuditCBand,
} from "@/lib/rules/mental-health-screening";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Latest mental-health screen summary (AHC pathway §11). Shown to the patient
 * (their own, gentle framing) and to the clinician (with scores). Rendered
 * only when at least one screen exists; RLS limits rows to the caller / org.
 */
export function MentalHealthSummary({
  patientId,
  showScores = false,
}: {
  patientId: string;
  showScores?: boolean;
}) {
  const { data } = useLatestMentalHealthScreens(patientId);
  if (!data) return null;
  const phq9 = data.phq9;
  const gad7 = data.gad7;
  const auditc = data.auditc;
  if (!phq9 && !gad7 && !auditc) return null;

  return (
    <Card variant="soft">
      <CardHeader>
        <CardTitle className="text-base">Mental wellbeing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {phq9 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70">Mood (PHQ-9)</span>
            <span className="flex items-center gap-2">
              {phq9.crisis_flagged && <Badge variant="red">Needs attention</Badge>}
              <Badge variant="grey">{PHQ9_BAND_LABEL[phq9.severity_band as Phq9Band] ?? phq9.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60">{phq9.total_score}/27</span>}
            </span>
          </div>
        )}
        {gad7 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70">Anxiety (GAD-7)</span>
            <span className="flex items-center gap-2">
              <Badge variant="grey">{GAD7_BAND_LABEL[gad7.severity_band as Gad7Band] ?? gad7.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60">{gad7.total_score}/21</span>}
            </span>
          </div>
        )}
        {auditc && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70">Alcohol (AUDIT-C)</span>
            <span className="flex items-center gap-2">
              {auditc.hazardous && <Badge variant="amber">Higher risk</Badge>}
              <Badge variant="grey">{AUDITC_BAND_LABEL[auditc.severity_band as AuditCBand] ?? auditc.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60">{auditc.total_score}/12</span>}
            </span>
          </div>
        )}
        {!showScores && (
          <p className="pt-1 text-xs text-charcoal-ink/60">
            Your care team can see these and will reach out if anything needs support.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
