"use client";

import {
  useMySeniorCaseReviews,
  type SeniorCaseReviewWithAnswerer,
} from "@/lib/queries/senior-case-review";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";

function ReviewRow({ review }: { review: SeniorCaseReviewWithAnswerer }) {
  const completed = review.status === "completed";
  const credential =
    review.reviewer?.credential_type && review.reviewer?.credential_number
      ? `${review.reviewer.credential_type} ${review.reviewer.credential_number}`
      : null;

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {review.situation_summary}
        </p>
        {completed ? (
          <Badge variant="green">Plan ready</Badge>
        ) : review.status === "declined" ? (
          <Badge variant="grey">Declined</Badge>
        ) : (
          <Badge variant="blue">With a senior doctor</Badge>
        )}
      </div>
      {!completed && review.status !== "declined" && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Expect a response by {formatPatientDateTime(review.sla_due_at)}.
        </p>
      )}
      {review.status === "declined" && review.declined_reason && (
        <p className="text-xs text-red-600 dark:text-red-300">
          {review.declined_reason}
        </p>
      )}
      {completed && review.written_plan && (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/[0.04] dark:bg-brand-green/15 p-3">
          <p className="whitespace-pre-wrap text-sm text-charcoal-ink dark:text-night-ink">
            {review.written_plan}
          </p>
          {review.reviewer && review.reviewed_at && (
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Dr. {review.reviewer.full_name}
              {credential ? ` (${credential})` : ""} ·{" "}
              {formatPatientDate(review.reviewed_at)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Senior Case Review — retired from patient purchase 2026-09-24 (founder
 * decision; see migration
 * 20260924055301_retire_senior_case_review_verified_documents_confidential_message.sql).
 * There is no request form here any more, only a read-only history so a
 * patient with a review already requested or completed before the
 * retirement still has somewhere to find their written plan. Renders
 * nothing once a patient has no reviews at all.
 */
export function SeniorCaseReviewCard({ patientId }: { patientId: string }) {
  const { data: reviews } = useMySeniorCaseReviews(patientId);

  if (!reviews || reviews.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senior case review</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {reviews.map((r) => (
            <ReviewRow key={r.id} review={r} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
