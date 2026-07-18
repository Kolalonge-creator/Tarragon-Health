"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgMedicationReviews,
  useCompleteMedicationReview,
  type MedicationReviewWithContext,
} from "@/lib/queries/medication-reviews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ReviewRow({ review }: { review: MedicationReviewWithContext }) {
  const complete = useCompleteMedicationReview();
  const [notes, setNotes] = useState("");
  const overdue = new Date(review.due_date) < new Date(new Date().toDateString());

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </p>
        {review.care_plan?.condition && (
          <Badge variant="green">{formatCondition(review.care_plan.condition)}</Badge>
        )}
        <Badge variant={overdue ? "red" : "amber"}>
          {overdue ? "Overdue" : "Due"} {new Date(review.due_date).toLocaleDateString()}
        </Badge>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`notes_${review.id}`} className="text-xs">
          Review notes (control, side effects, adherence, dose changes)
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
        onClick={() =>
          complete.mutate({ reviewId: review.id, notes: notes.trim() || null })
        }
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

export default function MedicationReviewsPage() {
  const { data, isLoading, isError } = useOrgMedicationReviews();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Medication reviews due</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load medication reviews.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No reviews are due right now. Reviews are scheduled automatically when a
              care plan is activated, at each condition&apos;s cadence.
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
