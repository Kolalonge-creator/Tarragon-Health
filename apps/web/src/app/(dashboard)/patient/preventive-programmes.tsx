"use client";

import { useMemo } from "react";
import type { Enums } from "@tarragon/shared";
import {
  usePreventiveProgrammes,
  usePreventiveEnrolments,
  useEnrolPreventiveProgramme,
  useWithdrawPreventiveProgramme,
} from "@/lib/queries/preventive-programmes";
import { useRiskScores } from "@/lib/queries/risk-assessment";
import { usePatientNextPreventiveReview } from "@/lib/queries/preventive-reviews";
import { useScreeningSchedules } from "@/lib/queries/screening";
import {
  computePreventiveProgrammeRecommendations,
  type ProgrammeRiskInput,
  type RiskTier,
} from "@/lib/rules/preventive-programme-recommendations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** prevention_risk_scores.tier is risk_level (has very_high); the engine works
 * in three tiers — collapse very_high into high. */
function toRiskTier(tier: Enums<"risk_level">): RiskTier {
  return tier === "very_high" ? "high" : tier;
}

const SCREENING_STATUS_LABEL: Record<Enums<"screening_status">, string> = {
  pending: "Due",
  booked: "Booked",
  completed: "Up to date",
  overdue: "Overdue",
  cancelled: "Not applicable",
};

/**
 * The Women's Health bridge: enrolling in the programme previously only
 * scheduled a generic periodic review, with no link to whether cervical/
 * breast screening was actually due — this composes the real
 * screen_types/screening_schedules status (already computed by the
 * age/sex-driven recommendation engine on risk-assessment submit) rather
 * than inventing a parallel cervical-specific engine.
 */
function WomensHealthScreeningStatus({ patientId }: { patientId: string }) {
  const schedules = useScreeningSchedules(patientId);
  const relevant = (schedules.data ?? []).filter(
    (s) => s.screen_type?.code === "cervical_smear" || s.screen_type?.code === "mammography"
  );

  if (schedules.isLoading || relevant.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5 rounded-md bg-brand-green/5 p-2">
      {relevant.map((schedule) => (
        <li key={schedule.id} className="text-xs text-charcoal-ink/70">
          <span className="font-medium">{schedule.screen_type?.name}</span>:{" "}
          {SCREENING_STATUS_LABEL[schedule.status]}
          {schedule.due_date && ` — ${new Date(schedule.due_date).toLocaleDateString()}`}
        </li>
      ))}
    </ul>
  );
}

export function PreventiveProgrammes({
  patientId,
  ageYears,
  sex,
}: {
  patientId: string;
  ageYears: number | null;
  sex: Enums<"sex"> | null;
}) {
  const programmes = usePreventiveProgrammes();
  const enrolments = usePreventiveEnrolments(patientId);
  const riskScores = useRiskScores(patientId);
  const nextReview = usePatientNextPreventiveReview(patientId);
  const enrol = useEnrolPreventiveProgramme(patientId);
  const withdraw = useWithdrawPreventiveProgramme(patientId);

  const recommendedByCode = useMemo(() => {
    const scores: ProgrammeRiskInput[] = (riskScores.data ?? []).map((score) => ({
      condition: score.condition,
      tier: toRiskTier(score.tier),
    }));
    const recs = computePreventiveProgrammeRecommendations(scores, { ageYears, sex });
    return new Map<string, string>(recs.map((rec) => [rec.code, rec.rationale]));
  }, [riskScores.data, ageYears, sex]);

  const enrolmentByProgramme = useMemo(() => {
    return new Map((enrolments.data ?? []).map((row) => [row.programme_id, row]));
  }, [enrolments.data]);

  const isLoading = programmes.isLoading || enrolments.isLoading;
  const isError = programmes.isError || enrolments.isError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Preventive programmes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          Choose a prevention track to follow. Each one bundles the right
          screenings and a periodic review with your care team.
        </p>
        {nextReview.data && (
          <p className="text-xs text-brand-green">
            Next health review due {new Date(nextReview.data.due_date).toLocaleDateString()}.
          </p>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load preventive programmes.</p>
        )}
        {programmes.data && programmes.data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No programmes available yet.</p>
        )}
        {programmes.data && programmes.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {programmes.data.map((programme) => {
              const enrolment = enrolmentByProgramme.get(programme.id);
              const rationale = recommendedByCode.get(programme.code);
              return (
                <li key={programme.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{programme.name}</p>
                    {enrolment ? (
                      <Badge variant="green">Enrolled</Badge>
                    ) : (
                      rationale && <Badge variant="amber">Recommended for you</Badge>
                    )}
                  </div>
                  {programme.description && (
                    <p className="text-xs text-charcoal-ink/60">{programme.description}</p>
                  )}
                  {!enrolment && rationale && (
                    <p className="text-xs text-charcoal-ink/50">{rationale}</p>
                  )}
                  {enrolment && programme.code === "womens_health" && (
                    <WomensHealthScreeningStatus patientId={patientId} />
                  )}
                  <div>
                    {enrolment ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={withdraw.isPending}
                        onClick={() => withdraw.mutate({ enrolmentId: enrolment.id })}
                      >
                        {withdraw.isPending ? "Updating…" : "Withdraw"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={enrol.isPending}
                        onClick={() =>
                          enrol.mutate({
                            programmeId: programme.id,
                            recommended: rationale !== undefined,
                          })
                        }
                      >
                        {enrol.isPending ? "Enrolling…" : "Enrol"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(enrol.isError || withdraw.isError) && (
          <p className="text-xs text-red-600">
            {((enrol.error ?? withdraw.error) as Error)?.message ||
              "Could not update your enrolment."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
