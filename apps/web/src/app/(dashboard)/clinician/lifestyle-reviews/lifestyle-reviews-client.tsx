"use client";

import { useActionState } from "react";
import { completeReview, type ReviewState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PendingReview {
  id: string;
  patientName: string;
  condition: string;
  dueDate: string;
}

export function LifestyleReviewsClient({ reviews }: { reviews: PendingReview[] }) {
  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          Nothing waiting. All lifestyle reviews are up to date.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <ReviewRow key={r.id} review={r} />
      ))}
    </div>
  );
}

function ReviewRow({ review }: { review: PendingReview }) {
  const [state, submit] = useActionState<ReviewState, FormData>(completeReview, undefined);
  const overdue = new Date(review.dueDate) < new Date();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{review.patientName}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="grey" className="capitalize">
            {review.condition}
          </Badge>
          <Badge variant={overdue ? "red" : "blue"}>
            Due {new Date(review.dueDate).toLocaleDateString()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={submit} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reviewId" value={review.id} />
          <div className="min-w-[220px] flex-1">
            <Input name="notes" placeholder="Review notes (optional)" />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Complete review
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}
