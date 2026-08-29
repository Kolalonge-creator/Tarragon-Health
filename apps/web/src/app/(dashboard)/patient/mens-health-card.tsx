"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRiskScores } from "@/lib/queries/risk-assessment";
import { usePatientDueCheckins } from "@/lib/queries/adherence-checkins";
import { usePatientNextPreventiveReview } from "@/lib/queries/preventive-reviews";
import { useLatestMensHealthAssessments } from "@/lib/queries/mens-health";
import { ED_SEVERITY_BAND_LABEL } from "@/lib/rules/ed-assessment-scoring";
import { PROSTATE_SYMPTOM_BAND_LABEL } from "@/lib/rules/prostate-symptom-scoring";
import { EdAssessmentForm } from "@/app/(dashboard)/patient/ed-assessment-form";
import { ProstateSymptomAssessmentForm } from "@/app/(dashboard)/patient/prostate-symptom-assessment-form";
import { MaleFertilityAssessmentForm } from "@/app/(dashboard)/patient/male-fertility-assessment-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

type Tab = "overview" | "erectile" | "prostate" | "fertility";

const RISK_TIER_BADGE: Record<string, "green" | "amber" | "red" | "grey"> = {
  low: "green",
  moderate: "amber",
  high: "red",
  very_high: "red",
  unknown: "grey",
};

/**
 * Men's Health hub (CLAUDE.md §45): sits alongside PreventiveProgrammes'
 * generic 'mens_health' programme row, same relationship
 * ReproductiveHealthCard has to the 'womens_health' one — the programme
 * list is the enrolment/screening-cadence surface, this card is the richer
 * per-domain content (§45.5 erectile dysfunction, §45.6 fertility, §45.7
 * prostate, §45.8 testicular, plus a snapshot strip in the spirit of §45.12's
 * dashboard). Mental wellbeing (§45.10) and cardiovascular prevention
 * (§45.9) are deliberately NOT rebuilt here — they link out to the existing
 * mental-health check-in (health-check page) and the existing CVD risk
 * engine (risk-scoring.ts, surfaced in the snapshot strip below) rather than
 * becoming a sixth isolated product on top of the same prevention engine.
 */
export function MensHealthCard({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const riskScores = useRiskScores(patientId);
  const dueCheckins = usePatientDueCheckins(patientId);
  const nextReview = usePatientNextPreventiveReview(patientId);
  const assessments = useLatestMensHealthAssessments(patientId);

  const cvdTier = useMemo(
    () => riskScores.data?.find((s) => s.condition === "cvd")?.tier ?? "unknown",
    [riskScores.data]
  );
  const prostateTier = useMemo(
    () => riskScores.data?.find((s) => s.condition === "prostate_ca")?.tier ?? "unknown",
    [riskScores.data]
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "erectile", label: "Erectile function" },
    { id: "prostate", label: "Prostate" },
    { id: "fertility", label: "Fertility" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Men&apos;s health
        </CardTitle>
        <CardDescription>
          Prevention, sexual and reproductive health, and the conditions that affect men
          specifically — confidential, and never a diagnosis on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={RISK_TIER_BADGE[cvdTier]}>Cardiovascular risk: {cvdTier}</Badge>
          <Badge variant={RISK_TIER_BADGE[prostateTier]}>Prostate risk: {prostateTier}</Badge>
          {nextReview.data && (
            <Badge variant="blue">
              Next review due {new Date(nextReview.data.due_date).toLocaleDateString()}
            </Badge>
          )}
          {(dueCheckins.data?.length ?? 0) > 0 && (
            <Badge variant="amber">{dueCheckins.data?.length} medication check-in(s) due</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-charcoal-ink/10 pb-3">
          {TABS.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={tab === t.id ? "default" : "outline"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-4 text-sm text-charcoal-ink/80">
            <section className="space-y-1 rounded-lg bg-brand-green/5 p-3">
              <p className="font-medium text-charcoal-ink">Testicular health</p>
              <p>
                A monthly self-check takes a minute and catches one of the most treatable cancers
                early (see &quot;Testicular self-checks&quot; in Learn). If you notice sudden or severe pain,
                or a new lump, log it from the Symptoms section — a testicular symptom is routed to
                your care team with the urgency it needs.
              </p>
            </section>
            <section className="space-y-1 rounded-lg bg-brand-green/5 p-3">
              <p className="font-medium text-charcoal-ink">Mental wellbeing</p>
              <p>
                Men report distress less often, not because they experience it less. Your{" "}
                <Link href="/patient/health-check" className="underline">
                  wellbeing check-in
                </Link>{" "}
                covers this confidentially, with a clinician always reviewing.
              </p>
            </section>
            <section className="space-y-1 rounded-lg bg-brand-green/5 p-3">
              <p className="font-medium text-charcoal-ink">Confidential sexual health</p>
              <p>
                HIV, hepatitis B and hepatitis C testing are available through your regular
                screening bundle — see the &quot;Screenings&quot; tab. Education on ED, fertility and
                prostate health is in Learn under &quot;Men&apos;s health&quot;.
              </p>
            </section>
            {assessments.data?.ed && (
              <p className="text-xs text-charcoal-ink/60">
                Last erectile function check-in: {ED_SEVERITY_BAND_LABEL[assessments.data.ed.severity_band as keyof typeof ED_SEVERITY_BAND_LABEL] ?? assessments.data.ed.severity_band}
              </p>
            )}
            {assessments.data?.prostate && (
              <p className="text-xs text-charcoal-ink/60">
                Last urinary symptom check-in: {PROSTATE_SYMPTOM_BAND_LABEL[assessments.data.prostate.severity_band as keyof typeof PROSTATE_SYMPTOM_BAND_LABEL] ?? assessments.data.prostate.severity_band}
              </p>
            )}
          </div>
        )}

        {tab === "erectile" && <EdAssessmentForm patientId={patientId} />}
        {tab === "prostate" && <ProstateSymptomAssessmentForm patientId={patientId} />}
        {tab === "fertility" && <MaleFertilityAssessmentForm patientId={patientId} />}
      </CardContent>
    </Card>
  );
}
