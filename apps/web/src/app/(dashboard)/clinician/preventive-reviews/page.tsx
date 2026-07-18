"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgPreventiveReviews,
  useCompletePreventiveReview,
  type PreventiveReviewWithContext,
} from "@/lib/queries/preventive-reviews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function ReviewRow({ review }: { review: PreventiveReviewWithContext }) {
  const complete = useCompletePreventiveReview();
  const [notes, setNotes] = useState("");
  const overdue = new Date(review.due_date) < new Date(new Date().toDateString());
  const programmeName = review.enrolment?.programme?.name;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </p>
        {programmeName && <Badge variant="green">{programmeName}</Badge>}
        <Badge variant={overdue ? "red" : "amber"}>
          {overdue ? "Overdue" : "Due"} {new Date(review.due_date).toLocaleDateString()}
        </Badge>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`notes_${review.id}`} className="text-xs">
          Review notes (findings, screenings ordered, lifestyle plan)
        </Label>
        <Textarea
          id={`notes_${review.id}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="text-sm"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={complete.isPending}
        onClick={() => complete.mutate({ reviewId: review.id, notes: notes.trim() || null })}
      >
        {complete.isPending ? "Completing…" : "Complete review"}
      </Button>
      {complete.isError && (
        <p className="text-xs text-red-600">
          {(complete.error as Error).message || "Could not complete this review."}
        </p>
      )}
    </li>
  );
}

export default function PreventiveReviewsPage() {
  const { data, isLoading, isError } = useOrgPreventiveReviews();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Periodic health reviews due</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load periodic reviews.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No reviews are due right now. A review is scheduled automatically when a
              patient enrols in a preventive programme, at that programme&apos;s cadence.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((review) => (
                <ReviewRow key={review.id} review={review} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
