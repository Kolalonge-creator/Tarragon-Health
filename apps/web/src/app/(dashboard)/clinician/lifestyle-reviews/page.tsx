"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgLifestyleReviews,
  useCompleteLifestyleReview,
  type LifestyleReviewWithPatient,
} from "@/lib/queries/lifestyle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function ReviewRow({ review }: { review: LifestyleReviewWithPatient }) {
  const complete = useCompleteLifestyleReview();
  const [notes, setNotes] = useState("");
  const overdue = new Date(review.due_date) < new Date(new Date().toDateString());

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </p>
        <Badge variant={overdue ? "red" : "amber"}>
          {overdue ? "Overdue" : "Due"} {new Date(review.due_date).toLocaleDateString()}
        </Badge>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`notes_${review.id}`} className="text-xs">
          Progress notes (diet, activity, weight, sleep, stress, next steps)
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

export default function LifestyleReviewsPage() {
  const { data, isLoading, isError } = useOrgLifestyleReviews();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Lifestyle progress reviews due</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load lifestyle reviews.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No progress reviews are due right now. A review is scheduled automatically when a
              patient starts lifestyle coaching, and rolls forward every three months.
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
