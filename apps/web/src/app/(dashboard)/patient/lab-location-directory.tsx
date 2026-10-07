"use client";

import { useState } from "react";
import { Star, Flag, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { listQueryState } from "@/lib/queries/list-query-state";
import {
  useLabTestLocations,
  useLabLocationReviews,
  useReportLabLocationReview,
  type LabTestLocation,
} from "@/lib/queries/lab-location-reviews";
import { formatPatientDate } from "@/lib/format-date";

function RatingSummary({ avgRating, reviewCount }: { avgRating: number | null; reviewCount: number }) {
  if (avgRating === null || reviewCount === 0) {
    return (
      <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">No reviews yet</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-charcoal-ink dark:text-night-ink">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      {avgRating.toFixed(1)}
      <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60">
        ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
      </span>
    </span>
  );
}

function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const report = useReportLabLocationReview();

  if (done) {
    return <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">Reported to our team</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-charcoal-ink/50 hover:text-charcoal-ink dark:text-night-ink/50 dark:hover:text-night-ink"
      >
        <Flag className="h-3 w-3" />
        Report
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-2">
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What's wrong with this review?"
        rows={2}
        className="text-xs"
      />
      {report.isError && (
        <p className="text-xs text-red-600 dark:text-red-300">Could not send that just now. Please try again.</p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!reason.trim() || report.isPending}
          onClick={() => report.mutate({ reviewId, reason }, { onSuccess: () => setDone(true) })}
        >
          {report.isPending ? "Sending…" : "Send report"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function LocationReviewsList({ locationId }: { locationId: string }) {
  const { data: reviews, isLoading } = useLabLocationReviews(locationId);

  if (isLoading) return null;
  if (!reviews || reviews.length === 0) {
    return <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">No reviews yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id} className="space-y-1 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={
                    i < review.rating
                      ? "h-3 w-3 fill-amber-400 text-amber-400"
                      : "h-3 w-3 text-charcoal-ink/20 dark:text-night-ink/20"
                  }
                />
              ))}
            </span>
            <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">
              {formatPatientDate(review.created_at)}
            </span>
          </div>
          {review.comment && (
            <p className="text-sm text-charcoal-ink dark:text-night-ink">{review.comment}</p>
          )}
          <ReportReviewButton reviewId={review.id} />
        </li>
      ))}
    </ul>
  );
}

function LocationRow({ location }: { location: LabTestLocation }) {
  const [showReviews, setShowReviews] = useState(false);

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
            {location.location_name}
          </p>
          <p className="flex items-center gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            <MapPin className="h-3 w-3" />
            {location.location_address}, {location.location_state}
          </p>
          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">{location.provider_name}</p>
        </div>
        <Badge variant="grey">{location.location_state}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <RatingSummary avgRating={location.avg_rating} reviewCount={location.review_count} />
        {location.review_count > 0 && (
          <button
            type="button"
            onClick={() => setShowReviews((v) => !v)}
            className="text-xs font-medium text-deep-forest dark:text-brand-green-bright hover:underline"
          >
            {showReviews ? "Hide reviews" : "See reviews"}
          </button>
        )}
      </div>
      {showReviews && <LocationReviewsList locationId={location.location_id} />}
    </li>
  );
}

/**
 * A read-only, verified directory of contracted lab branches — real
 * addresses and real patient ratings, tied only to a completed order the
 * reviewing patient actually placed (never an unverifiable testimonial; see
 * 20260924210135_lab_location_reviews.sql). Not a booking step: self-
 * arranged is still "take your request to any lab you like" (lab-catalogue.tsx);
 * this is where a patient decides which of the contracted branches to use,
 * and later comes back (via LabOrdersList's rate-lab-location prompt) to
 * say how it went.
 */
export function LabLocationDirectory() {
  const { data: locations, isLoading, isError } = useLabTestLocations();
  const state = listQueryState({ isLoading, isError, count: locations?.length });

  if (state === "error") {
    return <LoadErrorCard title="Contracted lab branches" what="the lab directory" />;
  }
  if (state === "empty") return null;
  if (state !== "ready" || !locations) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contracted lab branches</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Real branches Tarragon has contracted, with ratings from patients who actually completed a
          test there.
        </p>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {locations.map((location) => (
            <LocationRow key={location.location_id} location={location} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
