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
  toRiskTier,
  type ProgrammeRiskInput,
} from "@/lib/rules/preventive-programme-recommendations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";

const SCREENING_STATUS_LABEL: Record<Enums<"screening_status">, string> = {
  pending: "Due",
  booked: "Booked",
  completed: "Up to date",
  overdue: "Overdue",
  cancelled: "Not applicable",
  declined: "Declined",
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
    <ul className="mt-1 space-y-0.5 rounded-md bg-brand-green/5 dark:bg-brand-green/15 p-2">
      {relevant.map((schedule) => (
        <li key={schedule.id} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          <span className="font-medium">{schedule.screen_type?.name}</span>:{" "}
          {SCREENING_STATUS_LABEL[schedule.status]}
          {schedule.due_date && `, ${formatPatientDate(schedule.due_date)}`}
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

  /** Men's/Women's Health are sex-specific tracks — never offer the wrong one.
   * Sex unknown (not yet recorded) hides both rather than guessing. */
  const visibleProgrammes = useMemo(() => {
    return (programmes.data ?? []).filter((programme) => {
      if (programme.code === "mens_health") return sex === "male";
      if (programme.code === "womens_health") return sex === "female";
      return true;
    });
  }, [programmes.data, sex]);

  const isLoading = programmes.isLoading || enrolments.isLoading;
  const isError = programmes.isError || enrolments.isError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Preventive programmes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          We automatically enrol you in the prevention tracks that fit your
          profile — each one bundles the right screenings and a periodic
          review with your care team. You can leave any track at any time.
        </p>
        {nextReview.data && (
          <p className="text-xs text-brand-green dark:text-brand-green-bright">
            Next health review due {formatPatientDate(nextReview.data.due_date)}.
          </p>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load preventive programmes.</p>
        )}
        {programmes.data && visibleProgrammes.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No programmes available yet.</p>
        )}
        {programmes.data && visibleProgrammes.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {visibleProgrammes.map((programme) => {
              const enrolment = enrolmentByProgramme.get(programme.id);
              const rationale = recommendedByCode.get(programme.code);
              return (
                <li key={programme.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{programme.name}</p>
                    {enrolment ? (
                      <Badge variant="green">Enrolled</Badge>
                    ) : (
                      rationale && <Badge variant="amber">Recommended for you</Badge>
                    )}
                  </div>
                  {programme.description && (
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{programme.description}</p>
                  )}
                  {enrolment && enrolment.source === "recommended" && (
                    <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                      Enrolled automatically based on your profile. Withdraw any time.
                    </p>
                  )}
                  {!enrolment && rationale && (
                    <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{rationale}</p>
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
          <p className="text-xs text-red-600 dark:text-red-300">
            {((enrol.error ?? withdraw.error) as Error)?.message ||
              "Could not update your enrolment."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
