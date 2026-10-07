"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useLabTestLocations,
  useSetLabOrderLocation,
  useMyLabLocationReview,
  useSubmitLabLocationReview,
} from "@/lib/queries/lab-location-reviews";

/**
 * Lets a patient record which contracted branch they used (or intend to
 * use) for a self-arranged order — purely informational (never a partner
 * engagement; enforce_lab_order_origin is untouched by this), but it's what
 * unlocks rating that branch once the result lands. Optional: the download-
 * request / self-arranged path above works with this left unset forever.
 */
export function LabOrderLocationPicker({
  patientId,
  orderId,
  currentLocationId,
}: {
  patientId: string;
  orderId: string;
  currentLocationId: string | null;
}) {
  const { data: locations } = useLabTestLocations();
  const setLocation = useSetLabOrderLocation(patientId);
  const [expanded, setExpanded] = useState(!!currentLocationId);

  if (!locations || locations.length === 0) return null;

  const current = locations.find((l) => l.location_id === currentLocationId);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-deep-forest dark:text-brand-green-bright hover:underline"
      >
        Which lab branch are you using?
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={currentLocationId ?? ""}
        onChange={(e) => setLocation.mutate({ orderId, locationId: e.target.value || null })}
        className="max-w-xs text-xs"
      >
        <option value="">Choose a branch…</option>
        {locations.map((l) => (
          <option key={l.location_id} value={l.location_id}>
            {l.location_name} — {l.location_state}
          </option>
        ))}
      </Select>
      {setLocation.isPending && (
        <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">Saving…</span>
      )}
      {setLocation.isError && (
        <span className="text-xs text-red-600 dark:text-red-300">Could not save that just now.</span>
      )}
      {current && !setLocation.isPending && (
        <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">Saved</span>
      )}
    </div>
  );
}

function StarRatingInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(n)}
          className="p-0.5"
        >
          <Star
            className={
              n <= value
                ? "h-5 w-5 fill-amber-400 text-amber-400"
                : "h-5 w-5 text-charcoal-ink/20 dark:text-night-ink/20"
            }
          />
        </button>
      ))}
    </div>
  );
}

/**
 * The other half of the "real, consented" review discipline (see the
 * migration's own header comment): shown only once an order both has a
 * recorded branch and has reached 'resulted' — a genuinely completed visit,
 * never a free-standing testimonial. Once filed, a review can't be edited
 * or deleted here; that matches the staff-owned-once-filed posture the
 * migration documents.
 */
export function RateLabLocation({
  organisationId,
  patientId,
  labOrderId,
  locationId,
  locationName,
}: {
  organisationId: string;
  patientId: string;
  labOrderId: string;
  locationId: string;
  locationName: string;
}) {
  const { data: myReview, isLoading } = useMyLabLocationReview(labOrderId);
  const submitReview = useSubmitLabLocationReview();
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (isLoading) return null;

  if (myReview || submitted) {
    const shown = myReview ?? { rating, comment };
    return (
      <p className="flex items-center gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        You rated {locationName}
        <span className="inline-flex items-center gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={
                i < shown.rating
                  ? "h-3 w-3 fill-amber-400 text-amber-400"
                  : "h-3 w-3 text-charcoal-ink/20 dark:text-night-ink/20"
              }
            />
          ))}
        </span>
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-deep-forest dark:text-brand-green-bright hover:underline"
      >
        Rate {locationName}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">How was {locationName}?</p>
      <StarRatingInput value={rating} onChange={setRating} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional: what should other patients know? (not required)"
        rows={2}
        className="text-xs"
      />
      {submitReview.isError && (
        <p className="text-xs text-red-600 dark:text-red-300">Could not send that just now. Please try again.</p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={rating === 0 || submitReview.isPending}
          onClick={() =>
            submitReview.mutate(
              { organisationId, patientId, labOrderId, locationId, rating, comment },
              { onSuccess: () => setSubmitted(true) }
            )
          }
        >
          {submitReview.isPending ? "Sending…" : "Submit rating"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
