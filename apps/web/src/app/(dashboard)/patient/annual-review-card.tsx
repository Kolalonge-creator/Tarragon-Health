"use client";

import Link from "next/link";
import {
  usePatientAnnualReview,
  type AnnualReviewWithContext,
} from "@/lib/queries/annual-reviews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGES: { key: string; label: string; stampedBy: keyof AnnualReviewWithContext }[] = [
  { key: "questionnaire", label: "Questionnaires", stampedBy: "questionnaire_completed_at" },
  { key: "labs", label: "Laboratory tests", stampedBy: "labs_completed_at" },
  { key: "medication_review", label: "Medication review", stampedBy: "medication_review_completed_at" },
  { key: "risk_score", label: "Risk score", stampedBy: "risk_score_computed_at" },
  { key: "care_plan", label: "Updated care plan", stampedBy: "care_plan_updated_at" },
  { key: "video_consult", label: "Doctor video consult", stampedBy: "video_completed_at" },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Patient-facing annual review progress. Gated upstream by
 * RequiresEntitlement("annual_review"), so this only renders for subscribers of
 * a plan/add-on that includes the Annual Review programme. Every step and the
 * reviewer attribution are null-gated — nothing is shown as done until the DB
 * says so.
 */
export function AnnualReviewCard({ patientId }: { patientId: string }) {
  const { data: review, isLoading } = usePatientAnnualReview(patientId);

  if (isLoading || !review) {
    return null;
  }

  const completed = review.status === "completed";
  const workupDone = review.workup_items.filter((w) => w.status === "completed").length;
  const workupTotal = review.workup_items.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Your {review.cycle_year} annual health review</CardTitle>
        <Badge variant={completed ? "green" : "blue"}>
          {completed ? "Completed" : review.status === "in_progress" ? "In progress" : "Due"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          A once-a-year whole-body check that looks beyond your ongoing condition care — general
          bloods, heart and other screening, then a short video call with your Tarragon doctor to
          talk through your whole year and the plan ahead.
        </p>

        <ol className="space-y-1.5">
          {STAGES.map((stage) => {
            const done = Boolean(review[stage.stampedBy]);
            return (
              <li key={stage.key} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={
                    done
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700"
                      : "flex h-5 w-5 items-center justify-center rounded-full bg-charcoal-ink/10 text-charcoal-ink/40"
                  }
                >
                  {done ? "✓" : "•"}
                </span>
                <span className={done ? "text-charcoal-ink" : "text-charcoal-ink/60"}>
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>

        {workupTotal > 0 && (
          <p className="text-xs text-charcoal-ink/60">
            General workup: {workupDone} of {workupTotal} items completed.
          </p>
        )}

        {review.video_consultation_id && !completed && (
          <Link
            href="/patient/appointments"
            className="inline-block text-sm font-medium text-brand-green hover:underline"
          >
            Your annual review video consult is booked →
          </Link>
        )}

        {completed && review.completed_at && (
          <div className="rounded-md bg-green-50 p-3 text-sm">
            {review.reviewed_by_staff?.full_name ? (
              <p className="text-charcoal-ink">
                Reviewed by{" "}
                <span className="font-medium">Dr. {review.reviewed_by_staff.full_name}</span>
                {review.reviewed_by_staff.credential_type &&
                  review.reviewed_by_staff.credential_number && (
                    <span className="text-charcoal-ink/60">
                      {" "}
                      · {review.reviewed_by_staff.credential_type}{" "}
                      {review.reviewed_by_staff.credential_number}
                    </span>
                  )}
                <span className="text-charcoal-ink/60"> · {formatDate(review.completed_at)}</span>
              </p>
            ) : (
              <p className="text-charcoal-ink/70">
                Reviewed by your care team · {formatDate(review.completed_at)}
              </p>
            )}
            {review.year_summary && (
              <p className="mt-1 text-charcoal-ink/80">{review.year_summary}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
