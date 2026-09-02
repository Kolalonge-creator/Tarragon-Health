"use client";

import { useState } from "react";
import {
  useOrgSeniorCaseReviews,
  useMarkSeniorCaseReviewInReview,
  useDecideSeniorCaseReview,
  type SeniorCaseReviewWithPatient,
} from "@/lib/queries/senior-case-review";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function ReviewRow({ review }: { review: SeniorCaseReviewWithPatient }) {
  const markInReview = useMarkSeniorCaseReviewInReview();
  const decide = useDecideSeniorCaseReview();
  const [plan, setPlan] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const overdue = review.sla_due_at && new Date(review.sla_due_at) < new Date();

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </p>
        {review.status === "in_review" && <Badge variant="amber">In review</Badge>}
        {overdue && <Badge variant="red">SLA passed</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink">{review.situation_summary}</p>
      {review.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          Respond by {new Date(review.sla_due_at).toLocaleString()}
        </p>
      )}
      {review.status === "submitted" && (
        <Button
          size="sm"
          variant="outline"
          disabled={markInReview.isPending}
          onClick={() => markInReview.mutate(review.id)}
        >
          Start review
        </Button>
      )}

      <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
        <p className="text-xs font-medium text-charcoal-ink/70">
          Written plan (only a Tier 3+ doctor or Clinical Director can submit this)
        </p>
        <Textarea
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          rows={6}
          placeholder="A coordinated plan across everything this patient is managing — written for them, not for the chart."
        />
        <Button
          size="sm"
          disabled={decide.isPending || !plan.trim()}
          onClick={() => decide.mutate({ reviewId: review.id, decision: "completed", writtenPlan: plan.trim() })}
        >
          {decide.isPending ? "Sending…" : "Send plan"}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Textarea
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          rows={1}
          placeholder="Reason for declining (shown to the patient)"
          className="flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ reviewId: review.id, decision: "declined", declinedReason: declineReason })}
        >
          Decline
        </Button>
      </div>
      {decide.isError && (
        <p className="text-xs text-red-600">
          {(decide.error as Error).message || "Could not record this decision."}
        </p>
      )}
    </li>
  );
}

export default function SeniorCaseReviewsPage() {
  const { data, isLoading, isError } = useOrgSeniorCaseReviews();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Senior case reviews</h1>
        <p className="text-sm text-charcoal-ink/60">
          Complex, often multi-condition cases awaiting a coordinated written plan. Completing one
          is restricted server-side to Tier 3+ doctors and Clinical Directors — everyone can see
          the queue, but only a senior doctor&apos;s account can actually submit a plan.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((r) => (
                <ReviewRow key={r.id} review={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
