import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadLatestAgeingAssessment, missingDomains } from "@/lib/healthy-ageing/loaders";
import { DOMAIN_LABEL, OUTCOME_COPY, type AgeingAssessmentOutcome } from "@/lib/healthy-ageing/types";
import { AgeingAssessmentForm } from "./ageing-assessment-form";

const OUTCOME_BADGE_VARIANT: Record<AgeingAssessmentOutcome, "green" | "amber" | "blue"> = {
  no_concern: "green",
  monitor: "amber",
  further_assessment_suggested: "blue",
};

/**
 * Comprehensive ageing assessment (spec §50.3). Answered domains render as a
 * read-only summary with safe, non-diagnostic language (§50.6) — never a
 * label like "you have dementia," always "further assessment may be
 * appropriate." Unanswered domains get the form.
 */
export async function AgeingAssessmentSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const assessment = await loadLatestAgeingAssessment(supabase, patientId);
  const missing = missingDomains(assessment);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comprehensive check-in</CardTitle>
        <CardDescription>
          A few honest answers across the areas that matter most as you age — mobility, cognition,
          nutrition, vision and hearing, and more. This isn&apos;t a diagnosis; anything worth a closer
          look gets flagged for your care team to follow up on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {assessment && assessment.domainResults.length > 0 && (
          <ul className="space-y-2">
            {assessment.domainResults.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">{DOMAIN_LABEL[d.domain]}</p>
                  <p className="mt-0.5 text-xs text-charcoal-ink/60">{OUTCOME_COPY[d.outcome]}</p>
                </div>
                <Badge variant={OUTCOME_BADGE_VARIANT[d.outcome]}>
                  {d.clinicianReviewedAt ? "Reviewed" : "Recorded"}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {missing.length > 0 ? (
          <AgeingAssessmentForm domains={missing} />
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            All sections answered for this check-in. Your care team will follow up on anything flagged.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
