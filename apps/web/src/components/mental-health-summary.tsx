"use client";

import { useLatestMentalHealthScreens, useMentalHealthHandoffs, useMentalHealthScreenHistory } from "@/lib/queries/mental-health";
import { changeOverTime } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import {
  PHQ9_BAND_LABEL,
  GAD7_BAND_LABEL,
  AUDITC_BAND_LABEL,
  EPDS_BAND_LABEL,
  type Phq9Band,
  type Gad7Band,
  type AuditCBand,
  type EpdsBand,
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
  const { data, isError } = useLatestMentalHealthScreens(patientId);
  const history = useMentalHealthScreenHistory(patientId);
  const handoffs = useMentalHealthHandoffs(patientId);
  // A refusal must read as "not available to you", never as "no screens" (S56, INV-10, INV-12).
  if (isError) {
    return showScores ? (
      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Mental wellbeing</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {t("mood.denied.summary")}
        </CardContent>
      </Card>
    ) : null;
  }
  if (!data) return null;
  const changeLine = (instrument: string, max: number) => {
    const c = changeOverTime(history.data ?? [], instrument);
    if (c.sincePrevious === null || c.latest === null || c.previous === null) return null;
    const change = c.direction === "same" ? t("mood.change.same") : t(c.direction === "lower" ? "mood.change.lower" : "mood.change.higher", "en", { n: Math.abs(c.sincePrevious) });
    return (
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {t("mood.change.line", "en", { previous: c.previous, latest: c.latest, max, change })}
      </p>
    );
  };
  const phq9 = data.phq9;
  const gad7 = data.gad7;
  const auditc = data.auditc;
  const epds = data.epds;
  if (!phq9 && !gad7 && !auditc && !epds) return null;

  return (
    <Card variant="soft">
      <CardHeader>
        <CardTitle className="text-base">Mental wellbeing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {phq9 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70 dark:text-night-ink/70">Mood (PHQ-9)</span>
            <span className="flex items-center gap-2">
              {phq9.crisis_flagged && <Badge variant="red">Needs attention</Badge>}
              <Badge variant="grey">{PHQ9_BAND_LABEL[phq9.severity_band as Phq9Band] ?? phq9.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60 dark:text-night-ink/60">{phq9.total_score}/27</span>}
            </span>
          </div>
        )}
        {showScores && phq9 && changeLine("phq9", 27)}
        {gad7 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70 dark:text-night-ink/70">Anxiety (GAD-7)</span>
            <span className="flex items-center gap-2">
              <Badge variant="grey">{GAD7_BAND_LABEL[gad7.severity_band as Gad7Band] ?? gad7.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60 dark:text-night-ink/60">{gad7.total_score}/21</span>}
            </span>
          </div>
        )}
        {showScores && gad7 && changeLine("gad7", 21)}
        {auditc && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70 dark:text-night-ink/70">Alcohol (AUDIT-C)</span>
            <span className="flex items-center gap-2">
              {auditc.hazardous && <Badge variant="amber">Higher risk</Badge>}
              <Badge variant="grey">{AUDITC_BAND_LABEL[auditc.severity_band as AuditCBand] ?? auditc.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60 dark:text-night-ink/60">{auditc.total_score}/12</span>}
            </span>
          </div>
        )}
        {epds && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-charcoal-ink/70 dark:text-night-ink/70">Postnatal wellbeing (EPDS)</span>
            <span className="flex items-center gap-2">
              {epds.crisis_flagged && <Badge variant="red">Needs attention</Badge>}
              <Badge variant="grey">{EPDS_BAND_LABEL[epds.severity_band as EpdsBand] ?? epds.severity_band}</Badge>
              {showScores && <span className="text-charcoal-ink/60 dark:text-night-ink/60">{epds.total_score}/30</span>}
            </span>
          </div>
        )}
        {showScores && (handoffs.data ?? []).length > 0 && (
          <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2 text-xs">
            <p className="font-medium">{t("mood.handoff.sent_heading")}</p>
            {(handoffs.data ?? []).slice(0, 3).map((h) => (
              <p key={h.id} className="text-charcoal-ink/70 dark:text-night-ink/70">
                {new Date(h.created_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" })}
                {typeof h.summary.instrument === "string" ? `, ${String(h.summary.instrument).toUpperCase()} ${String(h.summary.severity_band ?? "")} ${String(h.summary.total_score ?? "")}`.trimEnd() : ""}
                {h.patient_note ? `: ${h.patient_note}` : ""}
              </p>
            ))}
          </div>
        )}
        {!showScores && (
          <p className="pt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Your care team can see these and will reach out if anything needs support.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
