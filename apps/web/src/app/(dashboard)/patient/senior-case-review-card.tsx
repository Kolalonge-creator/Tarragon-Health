"use client";

import { useState } from "react";
import {
  useMySeniorCaseReviews,
  useRequestSeniorCaseReview,
  type SeniorCaseReviewWithAnswerer,
} from "@/lib/queries/senior-case-review";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
const SENIOR_CASE_REVIEW_CREDIT_CODE = "senior_case_review_credit";

function ReviewRow({ review }: { review: SeniorCaseReviewWithAnswerer }) {
  const completed = review.status === "completed";
  const credential =
    review.reviewer?.credential_type && review.reviewer?.credential_number
      ? `${review.reviewer.credential_type} ${review.reviewer.credential_number}`
      : null;

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{review.situation_summary}</p>
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
        <p className="text-xs text-red-600 dark:text-red-300">{review.declined_reason}</p>
      )}
      {completed && review.written_plan && (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/[0.04] dark:bg-brand-green/15 p-3">
          <p className="whitespace-pre-wrap text-sm text-charcoal-ink dark:text-night-ink">{review.written_plan}</p>
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
 * Senior Case Review — pay-per-service item, no plan bypass: a Tier 3+
 * senior doctor (or Clinical Director) coordinates a complex, often
 * multi-condition case and delivers a written plan in-app. Renamed from
 * "multi-disciplinary case review" to avoid colliding with the separate
 * external specialist-network initiative (founder decision, 2026-08-31).
 */
export function SeniorCaseReviewCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: reviews } = useMySeniorCaseReviews(patientId);
  const { data: hasCredit, isLoading: isCheckingCredit } = useHasAvailableServicePurchase(
    patientId,
    SENIOR_CASE_REVIEW_CREDIT_CODE
  );
  const request = useRequestSeniorCaseReview();
  const [situationSummary, setSituationSummary] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  if (!organisationId) return null;

  function onSubmit() {
    setFormError(null);
    if (situationSummary.trim().length < 20) {
      setFormError("Tell us a bit more about your situation so a senior doctor can prepare properly.");
      return;
    }
    if (!organisationId) return;
    request.mutate(
      { patientId, organisationId, situationSummary: situationSummary.trim() },
      {
        onSuccess: () => setSituationSummary(""),
        onError: (error) => setFormError((error as Error).message || "Could not send this request."),
      }
    );
  }

  async function buyCredit() {
    setIsBuying(true);
    setFormError(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: SENIOR_CASE_REVIEW_CREDIT_CODE,
        callbackPath: "/patient/care",
      });
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
    } finally {
      setIsBuying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senior case review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Managing more than one condition, or feel your plan isn&apos;t quite right? A senior doctor
          reviews your whole record and sends you a written plan, coordinated across everything
          you&apos;re managing.
        </p>

        {!isCheckingCredit && !hasCredit && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">Buy a credit to request a review.</p>
            <Button size="sm" disabled={isBuying} onClick={buyCredit}>
              {isBuying ? "Redirecting to payment…" : "Buy a credit"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="senior-case-review-summary">Your situation</Label>
          <Textarea
            id="senior-case-review-summary"
            value={situationSummary}
            onChange={(e) => setSituationSummary(e.target.value)}
            rows={4}
            placeholder="e.g. I'm managing diabetes and hypertension together and my energy levels have dropped since my last medication change. I'd like someone to look at the whole picture."
            disabled={!hasCredit}
          />
        </div>
        {formError && <p className="text-sm text-red-600 dark:text-red-300">{formError}</p>}
        {request.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">
            Sent to a senior doctor. Expect a written plan within 5 days.
          </p>
        )}
        <Button onClick={onSubmit} disabled={request.isPending || !hasCredit}>
          {request.isPending ? "Sending…" : "Request review"}
        </Button>

        {reviews && reviews.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 border-t border-charcoal-ink/10 dark:border-night-ink/15">
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
